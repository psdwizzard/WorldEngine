/*
  WorldEngine Photoshop UXP plugin main entry.
  
  Mobile-first accordion UI for narrow PS panels.
*/

const uxp = require('uxp');

const panelHTML = `
<div class="we-app">
  <!-- Header bar: always visible -->
  <div class="we-header">
    <span class="we-logo">WE</span>
    <span id="status" class="we-status">Disconnected</span>
  </div>

  <!-- Accordion sections -->
  <div class="we-accordion">

    <!-- 1. Connect -->
    <div class="we-section" data-section="connect">
      <button class="we-section-btn is-open" data-section="connect">⚡ Connect</button>
      <div class="we-section-body is-open" data-section="connect">
        <label class="we-label">API URL</label>
        <input id="apiBaseUrl" class="we-input" type="text" value="http://localhost:4000" />
        <label class="we-label">Gemini Key</label>
        <input id="geminiKey" class="we-input" type="password" placeholder="optional" />
        <button id="connectBtn" class="we-btn we-btn-primary">Connect</button>
      </div>
    </div>

    <!-- 2. Project -->
    <div class="we-section" data-section="project">
      <button class="we-section-btn" data-section="project">📁 Project</button>
      <div class="we-section-body" data-section="project">
        <label class="we-label">Project</label>
        <select id="projectSlug" class="we-select"></select>
        <div class="we-tabs">
          <button class="we-tab is-active" data-tab="characters">Char</button>
          <button class="we-tab" data-tab="locations">Loc</button>
          <button class="we-tab" data-tab="items">Item</button>
          <button class="we-tab" data-tab="pages">Page</button>
        </div>
        <div id="tabContent" class="we-tab-content">
          <div class="we-muted">Connect first</div>
        </div>
      </div>
    </div>

    <!-- 3. Generate -->
    <div class="we-section" data-section="generate">
      <button class="we-section-btn" data-section="generate">🎨 Generate</button>
      <div class="we-section-body" data-section="generate">
        <label class="we-label">Prompt</label>
        <textarea id="prompt" class="we-textarea" rows="2" placeholder="Describe..."></textarea>
        <div class="we-row">
          <div class="we-col">
            <label class="we-label">Model</label>
            <select id="model" class="we-select">
              <option value="nano-banana">Nano</option>
              <option value="nano-banana-pro">Pro</option>
            </select>
          </div>
          <div class="we-col">
            <label class="we-label">W×H</label>
            <div class="we-row-inner">
              <input id="outWidth" class="we-input-sm" type="number" value="1024" />
              <span>×</span>
              <input id="outHeight" class="we-input-sm" type="number" value="1024" />
            </div>
          </div>
        </div>
        <div class="we-row-inner">
          <label class="we-label">Refs</label>
          <button id="clearRefsBtn" class="we-btn-mini">Clear</button>
        </div>
        <div id="selectedRefs" class="we-refs"></div>
        <button id="renderBtn" class="we-btn we-btn-primary" disabled>Render → Layer</button>
      </div>
    </div>

    <!-- 4. Sync -->
    <div class="we-section" data-section="sync">
      <button class="we-section-btn" data-section="sync">🔄 Sync</button>
      <div class="we-section-body" data-section="sync">
        <button id="createGroupBtn" class="we-btn" disabled>Create WE Group</button>
        <button id="createPanelFromLayerBtn" class="we-btn" disabled>Layer → Panel</button>
        <button id="syncPanelFromLayerBtn" class="we-btn" disabled>Sync Geometry</button>
      </div>
    </div>

  </div>
</div>
`;

const panelCSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }

/* UXP applies default Spectrum styles to buttons which forces tall rows.
   We reset buttons inside our app so the accordion headers don't waste space. */
.we-app button {
  all: unset;
  box-sizing: border-box;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.we-app button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.we-app input,
.we-app select,
.we-app textarea {
  font: inherit;
}

.we-app {
  font-family: system-ui, sans-serif;
  font-size: 8px;
  color: #ddd;
  background: #252525;
  min-height: 100%;
}

.we-header {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 4px;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  position: sticky;
  top: 0;
  z-index: 10;
}

.we-logo {
  font-weight: 700;
  font-size: 7px;
  color: #4a90d9;
}

.we-status {
  flex: 1;
  text-align: right;
  font-size: 7px;
  color: #888;
}

.we-accordion {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 20px);
}

.we-section {
  border-bottom: 1px solid #333;
  flex: 0 0 auto;
  display: block;
}

/* Active section expands to fill remaining height */
.we-section.is-open {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
}

.we-section-btn {
  width: 100%;
  display: block;
  text-align: left;
  padding: 1px 3px;
  background: #2f2f2f;
  border: none;
  color: #ccc;
  font-size: 7px;
  line-height: 1.1;
  cursor: pointer;
}

.we-section-btn:hover {
  background: #383838;
}

.we-section-btn.is-open {
  background: #3a3a3a;
  color: #fff;
}

.we-section-body {
  display: none;
  padding: 2px 3px;
  background: #2a2a2a;
}

.we-section-body.is-open {
  display: block;
  flex: 1 1 auto;
  overflow: auto;
}

.we-label {
  display: block;
  font-size: 6px;
  color: #888;
  margin: 0;
  line-height: 1;
}

.we-label:first-child {
  margin-top: 0;
}

.we-input,
.we-select,
.we-textarea {
  width: 100%;
  padding: 1px 2px;
  font-size: 7px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 2px;
  color: #ddd;
  margin: 0;
}

.we-input:focus,
.we-select:focus,
.we-textarea:focus {
  outline: none;
  border-color: #4a90d9;
}

.we-textarea {
  resize: vertical;
  min-height: 16px;
}

.we-input-sm {
  width: 40px;
  padding: 1px 2px;
  font-size: 7px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 2px;
  color: #ddd;
  text-align: center;
}

.we-row {
  display: flex;
  gap: 2px;
  margin-top: 1px;
}

.we-col {
  flex: 1;
}

.we-row-inner {
  display: flex;
  align-items: center;
  gap: 1px;
}

.we-row-inner span {
  color: #666;
  font-size: 6px;
}

.we-btn {
  display: block;
  width: 100%;
  padding: 2px 3px;
  margin-top: 1px;
  font-size: 7px;
  background: #3a3a3a;
  border: 1px solid #555;
  border-radius: 2px;
  color: #ccc;
  cursor: pointer;
}

.we-btn:hover:not(:disabled) {
  background: #444;
}

.we-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.we-btn-primary {
  background: #4a90d9;
  border-color: #4a90d9;
  color: #fff;
}

.we-btn-primary:hover:not(:disabled) {
  background: #5a9fe9;
}

.we-tabs {
  display: flex;
  gap: 0;
  margin-top: 1px;
}

.we-tab {
  flex: 1;
  padding: 1px 1px;
  font-size: 6px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 0;
  color: #888;
  cursor: pointer;
  line-height: 1;
}

.we-tab + .we-tab {
  /* overlap borders so there isn't a visible gap */
  margin-left: -1px;
}

.we-tab:first-child {
  border-top-left-radius: 2px;
  border-bottom-left-radius: 2px;
}

.we-tab:last-child {
  border-top-right-radius: 2px;
  border-bottom-right-radius: 2px;
}

.we-tab:hover {
  color: #ccc;
}

.we-tab.is-active {
  background: #4a90d9;
  border-color: #4a90d9;
  color: #fff;
}

.we-tab-content {
  margin-top: 1px;
  max-height: 50px;
  overflow-y: auto;
  background: #1e1e1e;
  border-radius: 2px;
  padding: 1px;
}

/* When Project is open, let the list use available height */
.we-section[data-section="project"].is-open .we-section-body.is-open {
  display: flex;
  flex-direction: column;
}

.we-section[data-section="project"].is-open .we-tab-content {
  flex: 1 1 auto;
  max-height: none;
  min-height: 120px;
}

.we-muted {
  font-size: 6px;
  color: #666;
  font-style: italic;
}

.we-entity-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.we-entity {
  border-bottom: 1px solid #333;
}

.we-entity-hdr {
  width: 100%;
  display: block;
  text-align: left;
  padding: 1px 3px;
  margin: 0;
  background: #2f2f2f;
  border: none;
  color: #ccc;
  font-size: 7px;
  cursor: pointer;
  line-height: 1;
}

.we-entity-hdr:hover {
  background: #383838;
}

.we-entity-grid {
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  background: #252525;
}

.we-thumb {
  width: calc(25% - 2px);
  aspect-ratio: 1;
  min-width: 50px;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  color: #666;
}

.we-thumb:hover {
  border-color: #4a90d9;
}

.we-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.we-refs {
  min-height: 10px;
  max-height: 24px;
  overflow-y: auto;
  background: #1e1e1e;
  border-radius: 2px;
  padding: 1px;
  margin-top: 1px;
}

.we-ref {
  display: inline-block;
  padding: 1px 2px;
  margin: 1px;
  font-size: 6px;
  background: #4a90d9;
  border-radius: 2px;
  color: #fff;
  cursor: pointer;
}

.we-ref:hover {
  background: #d95050;
}

.we-btn-mini {
  padding: 1px 3px;
  font-size: 6px;
  background: #333;
  border: 1px solid #555;
  border-radius: 2px;
  color: #888;
  cursor: pointer;
  margin-left: 4px;
}

.we-btn-mini:hover {
  background: #444;
}
`;

uxp.entrypoints.setup({
  panels: {
    'worldengine.panel': {
      create(rootNode) {
        const style = document.createElement('style');
        style.textContent = panelCSS;
        document.head.appendChild(style);
        rootNode.innerHTML = panelHTML;
        require('./main.js');
      },
      show() {},
      hide() {},
      destroy() {},
    },
  },
});
