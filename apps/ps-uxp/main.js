/*
  WorldEngine Photoshop UXP plugin (panel logic)
  Mobile-first accordion UI
*/

(function () {
  let app, core, action, uxp;

  try {
    const photoshop = require('photoshop');
    app = photoshop.app;
    core = photoshop.core;
    action = photoshop.action;
    uxp = require('uxp');
  } catch (err) {
    console.error('WorldEngine UXP boot failed', err);
    return;
  }

  const state = {
    apiBaseUrl: 'http://localhost:4000',
    projectSlug: '',
    geminiKey: '',
    connected: false,
    activeTab: 'characters',
    lastPanelId: '',
    projects: [],
    characters: [],
    locations: [],
    items: [],
    pages: [],
    selectedRefs: [], // array of asset IDs for multi-reference
  };

  const el = {};

  // Persisted local settings (stored in UXP plugin data folder, NOT your repo)
  const SETTINGS_FILENAME = 'worldengine-settings.json';

  async function getSettingsFile() {
    const folder = await uxp.storage.localFileSystem.getDataFolder();
    try {
      return await folder.getEntry(SETTINGS_FILENAME);
    } catch {
      return await folder.createFile(SETTINGS_FILENAME, { overwrite: false });
    }
  }

  async function loadSettings() {
    try {
      const file = await getSettingsFile();
      const text = await file.read({ format: uxp.storage.formats.utf8 });
      if (!text) return;
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.apiBaseUrl === 'string') state.apiBaseUrl = parsed.apiBaseUrl;
        if (typeof parsed.geminiKey === 'string') state.geminiKey = parsed.geminiKey;
        if (typeof parsed.projectSlug === 'string') state.projectSlug = parsed.projectSlug;
      }
    } catch (err) {
      // Best-effort; avoid blocking UI if settings read fails.
      console.warn('WorldEngine: failed to load settings', err);
    }
  }

  async function saveSettings() {
    try {
      const file = await getSettingsFile();
      const payload = {
        apiBaseUrl: state.apiBaseUrl,
        geminiKey: state.geminiKey,
        projectSlug: state.projectSlug,
        savedAt: new Date().toISOString(),
      };
      await file.write(JSON.stringify(payload, null, 2), { format: uxp.storage.formats.utf8 });
    } catch (err) {
      console.warn('WorldEngine: failed to save settings', err);
    }
  }

  function setStatus(msg, kind) {
    if (!el.status) return;
    el.status.textContent = msg;
    el.status.style.color = kind === 'error' ? '#ff5d5d' : '#888';
  }

  function getVal(input, fallback) {
    if (!input) return fallback || '';
    const v = input.value;
    return v == null ? (fallback || '') : String(v).trim();
  }

  function resolveUrl(path) {
    const base = (state.apiBaseUrl || '').replace(/\/$/, '');
    return base + (path.startsWith('/') ? path : '/' + path);
  }

  function headers(extra) {
    const h = Object.assign({ Accept: 'application/json' }, extra || {});
    // Always read Gemini key fresh from input (in case user entered it after connecting)
    const key = getVal(el.geminiKey, '') || state.geminiKey;
    if (key) h['x-gemini-key'] = key;
    if (state.projectSlug) h['x-project-slug'] = state.projectSlug;
    return h;
  }

  async function fetchJson(path, opts) {
    const res = await fetch(resolveUrl(path), Object.assign({}, opts, { headers: headers((opts || {}).headers) }));
    if (!res.ok) throw new Error(await res.text() || res.status);
    return res.json();
  }

  async function fetchBinary(path, opts) {
    const res = await fetch(resolveUrl(path), Object.assign({}, opts, { headers: headers((opts || {}).headers) }));
    if (!res.ok) throw new Error(await res.text() || res.status);
    return res.arrayBuffer();
  }

  /* ─────────────── Accordion ─────────────── */
  function openSection(name) {
    document.querySelectorAll('.we-section').forEach(sec => {
      sec.classList.toggle('is-open', sec.dataset.section === name);
    });
    document.querySelectorAll('.we-section-btn').forEach(btn => {
      btn.classList.toggle('is-open', btn.dataset.section === name);
    });
    document.querySelectorAll('.we-section-body').forEach(body => {
      body.classList.toggle('is-open', body.dataset.section === name);
    });
  }

  /* ─────────────── Project dropdown ─────────────── */
  function renderProjects() {
    if (!el.projectSlug) return;
    el.projectSlug.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '— select —';
    el.projectSlug.appendChild(empty);
    for (const p of state.projects) {
      const o = document.createElement('option');
      o.value = p.slug;
      o.textContent = p.name || p.slug;
      el.projectSlug.appendChild(o);
    }
    if (state.projectSlug) el.projectSlug.value = state.projectSlug;
  }

  /* ─────────────── Asset list ─────────────── */
  function renderSelectedRefs() {
    if (!el.selectedRefs) return;
    el.selectedRefs.innerHTML = '';
    for (const id of state.selectedRefs) {
      const span = document.createElement('span');
      span.className = 'we-ref';
      span.textContent = id.slice(0, 6);
      span.title = 'Click to remove: ' + id;
      span.addEventListener('click', () => {
        state.selectedRefs = state.selectedRefs.filter(r => r !== id);
        renderSelectedRefs();
        setStatus(state.selectedRefs.length + ' refs');
      });
      el.selectedRefs.appendChild(span);
    }
  }

  function assetThumb(id, label) {
    const wrap = document.createElement('div');
    wrap.className = 'we-thumb';
    wrap.title = label ? `${label}: ${id}` : id;

    const img = document.createElement('img');
    img.src = resolveUrl('/assets/' + id);
    img.alt = label || '';
    img.draggable = false;
    img.onerror = () => { wrap.textContent = '?'; };
    wrap.appendChild(img);

    wrap.addEventListener('click', () => {
      if (!state.selectedRefs.includes(id)) {
        state.selectedRefs.push(id);
        renderSelectedRefs();
      }
      setStatus(state.selectedRefs.length + ' refs');
    });
    return wrap;
  }

  function renderList(kind) {
    const wrap = document.createElement('div');
    wrap.className = 'we-entity-list';
    if (!state.connected) {
      wrap.innerHTML = '<div class="we-muted">Connect first</div>';
      return wrap;
    }
    const data = kind === 'characters' ? state.characters :
                 kind === 'locations' ? state.locations :
                 kind === 'items' ? state.items : state.pages;
    if (!data || !data.length) {
      wrap.innerHTML = '<div class="we-muted">None</div>';
      return wrap;
    }

    for (const rec of data) {
      const item = document.createElement('div');
      item.className = 'we-entity';

      // Collapsible header
      const hdr = document.createElement('button');
      hdr.type = 'button';
      hdr.className = 'we-entity-hdr';
      hdr.textContent = '▶ ' + (rec.name || rec.label || rec.id?.slice(0, 8) || '?');

      // Thumbnail grid (hidden by default, no space when collapsed)
      const grid = document.createElement('div');
      grid.className = 'we-entity-grid';
      grid.style.display = 'none';
      grid.style.padding = '0';

      // Gather asset ids (deduplicated by ID)
      const seen = new Set();
      const ids = [];
      function addId(label, id) {
        if (id && !seen.has(id)) {
          seen.add(id);
          ids.push([label, id]);
        }
      }
      if (rec.angles) Object.entries(rec.angles).forEach(([k, v]) => addId(k, v?.id));
      if (rec.slots) rec.slots.forEach(s => addId(s.label || 'slot', s.asset?.id));
      if (rec.primaryAssetId) addId('primary', rec.primaryAssetId);
      if (rec.spots) rec.spots.forEach(s => addId(s.label || 'spot', s.referenceAssetId));
      if (rec.angleAssets) Object.entries(rec.angleAssets).forEach(([k, v]) => addId(k, v?.id));

      for (const [lbl, id] of ids) grid.appendChild(assetThumb(id, lbl));

      // Toggle expand/collapse
      hdr.addEventListener('click', () => {
        const open = grid.style.display !== 'none';
        grid.style.display = open ? 'none' : 'flex';
        grid.style.padding = open ? '0' : '2px';
        hdr.textContent = (open ? '▶ ' : '▼ ') + (rec.name || rec.label || rec.id?.slice(0, 8) || '?');
      });

      item.appendChild(hdr);
      item.appendChild(grid);
      wrap.appendChild(item);
    }
    return wrap;
  }

  function renderTabs() {
    if (!el.tabContent) return;
    el.tabContent.innerHTML = '';
    el.tabContent.appendChild(renderList(state.activeTab));
  }

  /* ─────────────── Connect ─────────────── */
  async function connect() {
    state.apiBaseUrl = getVal(el.apiBaseUrl, 'http://localhost:4000');
    state.geminiKey = getVal(el.geminiKey, '');
    setStatus('Connecting…');

    const proj = await fetchJson('/projects');
    state.projects = proj.projects || [];
    renderProjects();

    if (!state.projectSlug && state.projects.length) {
      state.projectSlug = state.projects[0].slug;
      el.projectSlug.value = state.projectSlug;
    }
    state.projectSlug = getVal(el.projectSlug, state.projectSlug);

    const [c, l, i, p] = await Promise.all([
      fetchJson('/characters'),
      fetchJson('/locations'),
      fetchJson('/items'),
      fetchJson('/panels/pages'),
    ]);
    state.characters = c.characters || [];
    state.locations = l.locations || [];
    state.items = i.items || [];
    state.pages = p.pages || [];

    state.connected = true;
    el.renderBtn.disabled = false;
    el.createGroupBtn.disabled = false;
    el.createPanelFromLayerBtn.disabled = false;
    el.syncPanelFromLayerBtn.disabled = false;
    setStatus('OK (' + state.projectSlug + ')');
    renderTabs();
    openSection('project');

    // Persist settings after successful connect.
    await saveSettings();
  }

  /* ─────────────── Photoshop helpers ─────────────── */
  function findLayer(layers, name) {
    for (const l of layers || []) {
      if (l.name === name) return l;
      if (l.layers) { const f = findLayer(l.layers, name); if (f) return f; }
    }
    return null;
  }

  async function ensureGroup(name) {
    const doc = app.activeDocument;
    if (!doc) throw new Error('No document');
    await core.executeAsModal(async () => {
      if (findLayer(doc.layers, name)) return;
      await action.batchPlay([{ _obj: 'make', _target: [{ _ref: 'layerSection' }], using: { _obj: 'layerSection', name }, _options: { dialogOptions: 'dontDisplay' } }], { synchronousExecution: true, modalBehavior: 'execute' });
    }, { commandName: 'Create ' + name });
  }

  function toPx(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.value === 'number') return v.value;
    try { const c = v.as('px'); return typeof c === 'number' ? c : c.value || 0; } catch { return Number(v) || 0; }
  }

  function clamp01(n) { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }

  function geoFromLayer() {
    const doc = app.activeDocument;
    if (!doc) throw new Error('No document');
    const layer = doc.activeLayers?.[0];
    if (!layer?.bounds) throw new Error('No layer bounds');
    const l = toPx(layer.bounds.left), t = toPx(layer.bounds.top), r = toPx(layer.bounds.right), b = toPx(layer.bounds.bottom);
    const dw = toPx(doc.width), dh = toPx(doc.height);
    if (!dw || !dh) throw new Error('Doc size?');
    return { x: clamp01(l / dw), y: clamp01(t / dh), width: Math.max(0.01, clamp01((r - l) / dw)), height: Math.max(0.01, clamp01((b - t) / dh)) };
  }

  async function createPanelFromLayer() {
    const geo = geoFromLayer();
    const res = await fetchJson('/panels/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometry: geo }) });
    if (!res.panel?.id) throw new Error('Create failed');
    state.lastPanelId = res.panel.id;
    setStatus('Panel ' + res.panel.id.slice(0, 6));
  }

  async function syncLayerToPanel() {
    if (!state.lastPanelId) throw new Error('No panel yet');
    const geo = geoFromLayer();
    const layout = await fetchJson('/panels/layout');
    const page = layout.page;
    if (!page?.panels) throw new Error('No layout');
    page.panels = page.panels.map(p => p.id === state.lastPanelId ? { ...p, geometry: geo } : p);
    page.updatedAt = new Date().toISOString();
    await fetchJson('/panels/layout', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page }) });
    setStatus('Synced ' + state.lastPanelId.slice(0, 6));
  }

  async function renderToLayer() {
    const prompt = getVal(el.prompt, '');
    if (!prompt) throw new Error('Prompt?');
    const model = getVal(el.model, 'nano-banana');
    const w = Number(getVal(el.outWidth, '1024')) || 1024;
    const h = Number(getVal(el.outHeight, '1024')) || 1024;

    const create = await fetchJson('/panels/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const panel = create.panel;
    if (!panel?.id) throw new Error('Create failed');
    state.lastPanelId = panel.id;

    // Send refs exactly like the web app: referenceAssetId (primary) + referenceAssetIds (all)
    const refIds = state.selectedRefs.length > 0 ? state.selectedRefs : undefined;
    const primaryRefId = refIds ? refIds[0] : undefined;
    const render = await fetchJson('/panels/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId: panel.id, prompt, referenceAssetId: primaryRefId, referenceAssetIds: refIds, model, outputDimensions: { width: w, height: h } }) });
    const asset = render.asset;
    if (!asset?.id) throw new Error('Render failed');

    const bytes = await fetchBinary('/assets/' + asset.id);
    const tmp = await uxp.storage.localFileSystem.getTemporaryFolder();
    const file = await tmp.createFile('we-' + panel.id + '.png', { overwrite: true });
    await file.write(bytes, { format: uxp.storage.formats.binary });
    const token = uxp.storage.localFileSystem.createSessionToken(file);

    await core.executeAsModal(async () => {
      const doc = app.activeDocument;
      if (!doc) throw new Error('No document');
      await action.batchPlay([{ _obj: 'placeEvent', null: { _path: token, _kind: 'local' }, _options: { dialogOptions: 'dontDisplay' } }], { synchronousExecution: true, modalBehavior: 'execute' });
    }, { commandName: 'WE Render' });

    setStatus('Done ' + asset.id.slice(0, 6));
  }

  /* ─────────────── Bind ─────────────── */
  function bind() {
    el.status = document.getElementById('status');
    el.apiBaseUrl = document.getElementById('apiBaseUrl');
    el.geminiKey = document.getElementById('geminiKey');
    el.connectBtn = document.getElementById('connectBtn');
    el.projectSlug = document.getElementById('projectSlug');
    el.tabContent = document.getElementById('tabContent');
    el.prompt = document.getElementById('prompt');
    el.model = document.getElementById('model');
    el.outWidth = document.getElementById('outWidth');
    el.outHeight = document.getElementById('outHeight');
    el.selectedRefs = document.getElementById('selectedRefs');
    el.clearRefsBtn = document.getElementById('clearRefsBtn');
    el.renderBtn = document.getElementById('renderBtn');
    el.createGroupBtn = document.getElementById('createGroupBtn');
    el.createPanelFromLayerBtn = document.getElementById('createPanelFromLayerBtn');
    el.syncPanelFromLayerBtn = document.getElementById('syncPanelFromLayerBtn');

    // Accordion buttons
    document.querySelectorAll('.we-section-btn').forEach(btn => {
      btn.addEventListener('click', () => openSection(btn.dataset.section));
    });

    // Tabs
    document.querySelectorAll('.we-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.we-tab').forEach(t => t.classList.remove('is-active'));
        btn.classList.add('is-active');
        state.activeTab = btn.dataset.tab;
        renderTabs();
      });
    });

    el.connectBtn?.addEventListener('click', async () => {
      try { await connect(); } catch (e) { setStatus(e.message || String(e), 'error'); }
    });

    el.projectSlug?.addEventListener('change', () => {
      state.projectSlug = getVal(el.projectSlug, '');
      if (state.connected) el.connectBtn.click();
    });

    // Save as user edits fields (best-effort)
    el.apiBaseUrl?.addEventListener('change', async () => {
      state.apiBaseUrl = getVal(el.apiBaseUrl, state.apiBaseUrl);
      await saveSettings();
    });
    el.geminiKey?.addEventListener('change', async () => {
      state.geminiKey = getVal(el.geminiKey, state.geminiKey);
      await saveSettings();
    });

    el.clearRefsBtn?.addEventListener('click', () => {
      state.selectedRefs = [];
      renderSelectedRefs();
      setStatus('Refs cleared');
    });

    el.renderBtn?.addEventListener('click', async () => {
      try { setStatus('Rendering…'); await renderToLayer(); } catch (e) { setStatus(e.message || String(e), 'error'); }
    });

    el.createGroupBtn?.addEventListener('click', async () => {
      try { await ensureGroup('WorldEngine'); setStatus('Group OK'); } catch (e) { setStatus(e.message || String(e), 'error'); }
    });

    el.createPanelFromLayerBtn?.addEventListener('click', async () => {
      try { await createPanelFromLayer(); } catch (e) { setStatus(e.message || String(e), 'error'); }
    });

    el.syncPanelFromLayerBtn?.addEventListener('click', async () => {
      try { await syncLayerToPanel(); } catch (e) { setStatus(e.message || String(e), 'error'); }
    });
  }

  setTimeout(async () => {
    bind();
    await loadSettings();
    // Apply loaded settings into the UI inputs (if present)
    if (el.apiBaseUrl && state.apiBaseUrl) el.apiBaseUrl.value = state.apiBaseUrl;
    if (el.geminiKey && state.geminiKey) el.geminiKey.value = state.geminiKey;
    setStatus('Ready');
  }, 0);
})();
