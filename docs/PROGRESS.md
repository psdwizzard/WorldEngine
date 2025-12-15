# World Generator MVP Progress

## Current Focus
- [x] Scaffold monorepo with npm workspaces (`apps/web`, `apps/api`, `packages/shared`, `packages/config`).
- [x] Bootstrap Vite + React UI with tab navigation and storyboard placeholders.
- [x] Create Express API shell with health check and Gemini integration stubs.
- [x] Define shared TypeScript models for characters, locations, items, and panels.
- [x] Draft `.env.example` files documenting Gemini credentials and data root configuration.
- [x] Persist character slots and assets to disk (`tmp/data`), including placeholder Gemini generation flow.
- [x] Implement draggable panel geometry and persistence.
- [x] **Panel Layout MVP: drag-to-resize panel boxes with metadata form binding.**
- [x] **Asset Pipeline: replace stubbed Gemini flow with real API calls and background job handling.**

## Upcoming Milestones
1. Generation Review Flow: approve/reject renders and persist storyboard state.
2. Storage Hardening: explore SQLite/Prisma or cloud storage for long-term persistence; add migrations/backups.

## Notes
- `DATA_ROOT` in `apps/api/.env.example` now defaults to `output`, and every character/location/item/storyboard asset is scoped to `output/projects/<slug>/…`.
- `/projects` API plus shared `ProjectSummary`/`PromptPresetSet` types enable per-series storage and prompt defaults.
- Web settings tab now includes a project picker, creator, and prompt preset editor; the selected project slug is forwarded on every API call.
- `npm run lint` and `npm run typecheck` pass; `npm run test` runs per-workspace (API tests currently cover persistence stub).
- Multer 1.x shows deprecation warnings; plan to upgrade alongside file upload work.

## Current Working State
- **Panel Layout MVP is complete** with full drag-to-resize functionality and metadata binding
- **Asset Pipeline is complete** with real image generation functionality
- **Project-aware persistence is live**: assets/manifests live under `output/projects/<slug>` and character/location/item APIs filter by project.
- **Prompt presets** can be edited per project (characters, locations, items, storyboard) and auto-populate generation flows.
- Development servers running on:
  - Web UI: http://localhost:6248
  - API: http://localhost:4000
- All TypeScript compilation passes without errors
- API endpoints tested and working

## Asset Pipeline Implementation Details
- Implemented `generateImage()` function with live calls to Gemini's `gemini-2.5-flash-image` model (falls back to placeholder art only when the API response lacks inline image data or errors)
- Generated images are properly stored and accessible via asset API, namespaced under the active project
- Ready for integration with specialized Imagen endpoints when available
