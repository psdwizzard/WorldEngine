# Repository Guidelines

## Project Structure & Module Organization
- `apps/web` hosts the Vite + React TypeScript UI for the character, location, item, and panel workflow tabs.
- `apps/api` is an Express + TypeScript service exposing Gemini prompt orchestration, asset storage, and panel layout endpoints.
- `packages/shared` keeps cross-cutting types, prompt builders, and schema validators used by both apps.
- `packages/config` centralizes eslint, prettier, tsconfig, and vite configs; update them here for repo-wide changes.
- `assets/` stores seed reference images; generated outputs should stream to a cloud bucket during runtime rather than being committed.

## Build, Test, and Development Commands
- `npm install` boots the workspace and links sub-project dependencies.
- `npm run dev` starts both the web and API servers via `concurrently` with hot reload.
- `npm run dev:web` / `npm run dev:api` serve a single surface when debugging.
- `npm run lint` runs ESLint with TypeScript-aware rules to catch style and API mistakes.
- `npm run test` executes Vitest suites (frontend) and API integration tests.
- `npm run typecheck` ensures strict TypeScript across all packages before merges.

## Coding Style & Naming Conventions
- TypeScript is strict; prefer interfaces over types for shareable shapes and zod for runtime guards.
- Prettier enforces 2-space indentation, single quotes, and trailing commas where valid.
- Components, hooks, and classes use PascalCase; functions and variables use camelCase; files and directories use kebab-case.
- Keep Gemini prompt templates in `packages/shared/prompts` with descriptive filenames (e.g., `character-side.prompt.ts`).

## Testing Guidelines
- Use Vitest with React Testing Library for UI state, and supertest-powered Vitest suites for API contracts.
- Add regression specs whenever adding new tab flows or Gemini prompt variants.
- Integration fixtures live under `apps/api/test/fixtures`; mirror naming with the route under test.
- Pull requests should keep `npm run test -- --coverage` at or above 80% on statements and lines.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat:`, `fix:`, `chore:`) to drive changelog automation.
- Each PR must include: linked issue, summary checklist, screenshots or panel JSON samples, and notes on Gemini credit usage.
- Rebase before merging; avoid merge commits on `main`.

## Security & Configuration Notes
- Store Gemini API keys in `.env.local` for each app; never commit secrets.
- Document required environment vars in `apps/api/.env.example` and `apps/web/.env.example` when new integrations land.
- Restrict local file writes to the workspace; use signed URLs for long-lived assets.