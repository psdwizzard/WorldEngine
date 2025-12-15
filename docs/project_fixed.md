# World Generator (WorldEngine) – Project Handoff

This doc is a handoff for anyone picking up the repo: what the app does, how it’s wired, and where to extend it.

---

## 1. High‑Level Architecture

- **Web app** (`apps/web`)
  - Vite + React + TypeScript SPA.
  - Tabs: **Characters**, **Locations**, **Items**, **Panels**, **Project Assets**, **Settings**.
  - Uses `useSettings` to persist workspace settings and the active project in `localStorage`.

- **API service** (`apps/api`)
  - Express + TypeScript.
  - Routes:
    - `/characters` – character records, turnaround slots, uploads, and Gemini‑driven generation.
    - `/locations` – primary references and secondary “spot” views, plus on‑the‑fly generated views.
    - `/items` – item references with primary/alternate angles.
    - `/panels` – storyboard page + panel layout.
    - `/projects` – project metadata + prompt presets.
  - Gemini integration via `apps/api/src/lib/gemini.ts`.

- **Shared types & prompts** (`packages/shared`)
  - TypeScript interfaces for `CharacterProfile`, `CharacterTurnaroundSlot`, `LocationBlueprint`, `ItemReference`, `StoryboardPage`, etc.
  - Prompt preset types aligning the web and API.

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
    - Web: `http://localhost:6248`
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

- **Project selection & “remember last project”**
  - Web settings are stored in `localStorage` under `worldengine.settings`.
  - `useSettings`:
    - Reads settings at startup.
    - `updateSetting` writes immediately back to storage (including `projectId` and `projectSlug`).
  - Result: when you select a project (via the header picker or Settings), that project is remembered across reloads and machine restarts without requiring an explicit “Save Settings”.

---

## 4. Characters Flow

### 4.1 Turnaround builder (Characters tab)

- **Front reference**
  - Uploads a front image and creates/updates a “front” slot.
  - Marks the slot as default; this image is used as the reference for angle generation.
  - UI shows:
    - Inline thumbnail preview.
    - “Open full size” link.

- **Generate supporting views**
  - Supported angles: `left`, `right`, `back` (types include `side`, `three-quarter` as well).
  - Prompt precedence per angle:
    1. Typed prompt in the Character tab for that angle.
    2. Composed prompt using project presets:
       - Narrative: “Generate a \<angle> view of the character consistent with the reference image.”
       - `character.defaultPrompt` (if present).
       - `character.anglePrompts[angle]` (if present).
       - Consistency hints: white background, match colors/proportions, keep costume/palette consistent.
    3. Fallback: “Generate a character image for \<name>”.
  - Generated images:
    - Stored under `apps/api/output/projects/<slug>/characters/...`.
    - Saved as assets and attached to slots with an angle + label.

- **Saved references**
  - All slots with assets (front + generated + custom) appear under “Saved references” as cards:
    - Slot label (renameable) and angle description.
    - Inline image preview.
    - “Open full size” link.

### 4.2 Project Assets – character library

- **Character list**
  - The **Project Assets** tab shows all characters for the active project:
    - Name.
    - Thumbnail (front angle asset if present).
    - Created/updated timestamps.
    - Actions:
      - `View` – opens character details view.
      - `Rename` – renames the character.
      - `Delete` – removes the character and its slots for this project.

- **Character detail view**
  - Shows timestamps and summary.
  - Per‑angle tiles (Front, Left, Right, Back, etc.):
    - Heading label:
      - Uses the slot’s label if set (your semantic view name).
      - Falls back to the default angle label otherwise.
    - Thumbnail:
      - Clicking the image opens it in a new tab via `assetHref`.
    - Buttons per view:
      - `Rename` – updates the slot label (view name).
      - `Download` – downloads the image as `<slugified-character-name>-<angle>.<ext>`.
      - `Replace` – uploads a new image for that angle; preserves the view name.
      - `Delete` – removes that view slot (guarded so at least one slot remains).
      - `Add view` – for angles without an asset, upload to create that view.
  - View naming:
    - When you replace a view, the existing slot label is reused instead of overwritten.
    - This makes names like “Rabbit-front”, “Rabbit-in-costume-front” stable references for prompts and storyboard lookups.

---

## 5. Locations Flow

### 5.1 Location Library tab

- **Primary reference**
  - You can name the location (e.g., “Kitchen”) and upload a reference image.
  - Optionally specify a “secondary spot label” (e.g., “Oven counter”) during upload; this creates/updates a `LocationSpot` with its own `referenceAssetId`.

- **Stored views**
  - Each `LocationBlueprint` has:
    - `primaryAssetId` – main view.
    - `spots: LocationSpot[]` – secondary views.
  - The “Stored Views” section shows:
    - Primary asset id with a link (if present).
    - A row per spot: spot label and a link if `referenceAssetId` exists.

- **Generate extra view (one‑off prompt)**
  - A dedicated “Generate extra view” card lets you:
    - Set a **Secondary view label** (e.g., “Noodle stand counter”).
    - Write a **Prompt for this view** (text is *not* saved as a preset).
    - Click **Generate View**:
      - Calls `POST /locations/generate-view`.
      - Composes a prompt using:
        - Project `location.defaultPrompt` (style).
        - Project `location.spotPrompt` (environment hints).
        - The one‑off view prompt.
      - Stores the new image as an asset and attaches it to a `LocationSpot` whose label matches the secondary view label.
      - Updates the current `LocationBlueprint` in the UI and shows the new asset id.

### 5.2 Project Assets – location library

- **Location list**
  - The **Project Assets** tab now includes a Locations section:
    - Loads all `LocationBlueprint` records.
    - Each card shows:
      - Location name.
      - Thumbnail:
        - Uses the primary asset if present.
        - Otherwise uses the first spot with a `referenceAssetId`.
      - Helper text: “No secondary spots yet.” or “N secondary spot(s).”
  - This is the library view for locations, analogous to the character library and intended to grow with:
    - Per‑location detail views.
    - Per‑spot actions (view/download/replace/delete/rename) using the same pattern as characters.

---

## 6. Items and Panels

- **Items**
  - Item records live in memory via `/items` routes and are stored with:
    - `angleAssets.primary`
    - `angleAssets.alternate`
  - The Items tab handles:
    - Item label.
    - Upload for primary/alternate references.
    - Status messages and asset ids.
  - Project Assets has a placeholder Items section ready for a library‑style view similar to characters/locations.

- **Panels / Storyboard**
  - Models:
    - `StoryboardPage` – page dimensions and metadata.
    - `StoryboardPanel` – geometry + prompt metadata.
  - The Panels tab:
    - Loads page layout via `GET /panels/layout`.
    - Saves updates via `PUT /panels/layout`.
    - Lets you:
      - Add/remove panels.
      - Drag/resize panels in a normalized 0–1 coordinate space.
    - Uses prompt presets (`storyboard.panelPrompt`, `storyboard.layoutPrompt`) as the basis for downstream prompt generation.

---

## 7. Storage Layout (API)

- Root output directory is under `apps/api/output` by default.

- Key files:
  - `apps/api/output/projects.json` – list of projects and their prompt presets.
  - `apps/api/output/projects/<slug>/characters.json` – character records, including slots and angles.
  - `apps/api/output/projects/<slug>/assets.json` – asset registry.

- Asset directories (per project):
  - `characters/<characterId>/<slotId>/...` – character images (reference + generated).
  - `locations/<locationId>/<spotId>/...` – location images (primary + generated views).
  - `items/<itemId>/<angle>/...` – item images.

The web client never hard‑codes these paths; it only uses `AssetReference.url` passed through `assetHref(...)`.

---

## 8. Troubleshooting & Notes

- **“Failed to fetch” when creating a project**
  - Ensure `VITE_API_BASE_URL` points at the API (typically `http://localhost:4000`).

- **`invalid_project_payload` when saving prompts**
  - API accepts empty strings and trims values; ensure both apps are up‑to‑date and restart the dev servers.

- **Placeholder image on first generation**
  - If Gemini doesn’t return an inline image, the API falls back to a generated placeholder image; try again or refine the prompt.

- **Generated angles look like the front view**
  - Make sure:
    - Angle‑specific prompts are set (in the Characters tab or project presets).
    - The front reference is uploaded and set as default.

- **`Missing GEMINI_API_KEY`**
  - Either:
    - Set `GEMINI_API_KEY` in `apps/api/.env.local`, or
    - Fill the Gemini key in Settings (web), which sends `x-gemini-key` with requests.

- **Scripts**
  - Root:
    - `npm run dev`
    - `npm run lint`
    - `npm run test`
    - `npm run typecheck`
  - Web only:
    - `npm --workspace @worldengine/web run dev`
  - API only:
    - `npm --workspace @worldengine/api run dev`

- **Code style**
  - TypeScript strict across packages; use `zod` for runtime validation.
  - Prettier: 2‑space indentation, single quotes, trailing commas.
  - Do not commit secrets; `.env.local` only.

