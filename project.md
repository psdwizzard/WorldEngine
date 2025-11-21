# World Generator (WorldEngine) – Project Handoff

This doc is a handoff for anyone picking up the repo: what the app does, how it’s wired, and where to extend it.

---

## 1. High‑Level Architecture

- **Web app** (`apps/web`)
  - Vite + React + TypeScript SPA.
  - Tabs: **Characters**, **Locations**, **Items**, **Panels**, **Project Assets**, **Settings**.
  - Uses `useSettings` to persist workspace settings, including the active project and default page background color in `localStorage`.

- **API service** (`apps/api`)
  - Express + TypeScript.
  - Routes:
    - `/characters` – character records, turnaround slots, uploads, and Gemini‑driven generation.
    - `/locations` – primary references and secondary “spot” views, plus on‑the‑fly generated views.
    - `/items` – item references with primary/alternate angles.
    - `/panels` – storyboard page + panel layout (CRUD operations, including create/delete/render).
    - `/projects` – project metadata + prompt presets.
  - Gemini integration via `apps/api/src/lib/gemini.ts` (handles text and image prompts, including resizing inputs to avoid aspect ratio bias).

- **Shared types & prompts** (`packages/shared`)
  - TypeScript interfaces for `CharacterProfile`, `LocationBlueprint`, `StoryboardPage`, `PanelGeometry`, etc.
  - `PanelGeometry` supports `cornerOffsets` for free-form, non-rectangular panels.
  - `StoryboardPanel` supports `strokeWidth` and `strokeColor`.

- **Storage**
  - All runtime output lives under `apps/api/output`:
    - `apps/api/output/projects.json` – projects + prompt presets.
    - `apps/api/output/projects/<slug>/` – per‑project data and assets.

---

## 2. Getting Started

- Install dependencies:
  - `npm install`
- Run dev servers (web + API concurrently):
  - `npm run dev`
    - Web: `http://localhost:5173`
    - API: `http://localhost:4000`
- Lint / typecheck / tests:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`

### API Base URL

- Web uses `VITE_API_BASE_URL` to find the API.
- Defaults to `http://localhost:4000`. Override via `apps/web/.env.local`:
  - `VITE_API_BASE_URL=http://localhost:4000`

### Gemini API Key

Provide the Gemini key one of two ways:

- **Server env** – `apps/api/.env.local`
  - `GEMINI_API_KEY=your-key`
- **UI Settings** – “Gemini API key” field (stored in `localStorage`).
  - Sent on requests as `x-gemini-key`.

The API prefers the header; if missing, it falls back to `.env.local`.

> `apps/api/.env.local` is ignored via the repo `.gitignore`, so the key never becomes part of your Git history. Keep the real value only in that file (or in process env vars) and *never* inside tracked source files. If you suspect a secret was committed previously, rotate it in the Google Cloud console and then run `git push --force-with-lease` after rewriting history (e.g., via `git filter-repo`) to scrub the old value.

---

## 3. Projects, Settings, and Persistence

- **Projects**
  - Created via the **Settings** tab or `/projects` API.
  - Each project: `id`, `slug`, `name`, `description?`, `issueLabel?`, `promptPresets?`.
  - The active project scopes asset storage and prompt composition.

- **Prompt presets shape** (all text fields optional):
  - `character.defaultPrompt`
  - `character.anglePrompts[front|left|right|back|side|three-quarter]`
  - `location.defaultPrompt`, `location.spotPrompt`
  - `item.defaultPrompt`, `item.alternatePrompt`
  - `storyboard.panelPrompt`, `storyboard.layoutPrompt`

- **Persistence**
  - Web settings (`worldengine.settings`) include:
    - `projectId`, `projectSlug`: remembers the last active project.
    - `defaultPageBackgroundColor`: remembers your preferred storyboard page color.
  - Changes are auto-saved to `localStorage`.

---

## 4. Characters Flow

- **Turnaround builder (Characters tab)**
  - Uploads a front image (default reference).
  - Generates supporting views (left, right, back) using Gemini.
  - Prompts are composed from user input + project presets.

- **Project Assets**
  - Library view for managing character assets.
  - Actions: View, Rename, Download, Replace, Delete.

---

## 5. Locations Flow

- **Location Library**
  - Primary reference + secondary "spot" views.
  - "Generate extra view" uses Gemini to create new angles or entirely new locations based on an existing image.

---

## 6. Storyboard & Panels

- **Layout Mode**
  - **Pages:** Create and delete pages. Background color preference is remembered.
  - **Panels:**
    - Add/remove panels.
    - **Standard Mode:** Resize/move rectangular panels.
    - **Free Mode:** Adjust each corner independently (pixel-based offsets) for non-rectangular shapes.
    - **Styling:** Set stroke width and color.
  - **Auto-Save:** Layout changes are automatically saved after 1 second of inactivity.
  - **Export:** Downloads the page as a PNG, rendering strokes and respecting custom panel shapes (clipping).

- **Prompt & Render**
  - **Prompt Builder:** Select character, location, and items to auto-fill context.
  - **Generation:**
    - Sends the prompt + reference images (character/location) to Gemini.
    - **Resolution Fix:** Input images are resized/padded to a square (1024x1024) canvas before sending to prevent the model from mimicking the input aspect ratio.
  - **Framing:** Pan/zoom the generated image within the panel mask.

- **Library Mode**
  - View rendered panels, download individual images, or replace them manually.

---

## 7. Storage Layout (API)

- Root output directory is under `apps/api/output` by default.

- Key files:
  - `apps/api/output/projects.json` – projects + prompt presets.
  - `apps/api/output/projects/<slug>/characters.json` – character records.
  - `apps/api/output/projects/<slug>/panels.json` – storyboard pages and layouts.
  - `apps/api/output/projects/<slug>/assets.json` – asset registry.

- Asset directories (per project):
  - `characters/<characterId>/<slotId>/...`
  - `locations/<locationId>/<spotId>/...`
  - `items/<itemId>/<angle>/...`
  - `panels/<pageId>/<panelId>/...`

---

## 8. Troubleshooting & Notes

- **“Failed to fetch”** check `VITE_API_BASE_URL`.
- **Generated images are non-square:**
  - The API now forcibly pads inputs to 1024x1024. Ensure you are using the latest `apps/api/src/routes/panels.ts`.
- **Stroke not showing on export:**
  - Ensure `strokeWidth` > 0. The export logic draws strokes on top of the clipped image.