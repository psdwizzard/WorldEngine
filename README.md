# WorldEngine

A web-based storyboard and world-building tool powered by Google Gemini AI. Create characters, locations, items, and composite them into storyboard panels with AI-assisted image generation.

## Features

- **Character Creator** - Build character turnarounds with multiple angles (front, back, left, right)
- **Location Library** - Manage location references and generate additional views/angles
- **Item Management** - Store and organize props and items with multiple angles
- **Storyboard Panels** - Create multi-page storyboards with customizable panel layouts
  - Free-form panel shapes with corner manipulation
  - Custom stroke colors and widths
  - AI-powered panel rendering using character/location references
  - Export to PNG with proper clipping and styling
- **Project System** - Organize work into separate projects with custom prompt presets
- **Asset Management** - Centralized library for viewing, downloading, and managing all project assets

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up your Gemini API key:**
   - Create `apps/api/.env.local` and add:
     ```
     GEMINI_API_KEY=your-key-here
     ```
   - Or enter it in the Settings tab (stored in localStorage)

3. **Start the dev servers (both bind to 0.0.0.0 for LAN access):**
   ```bash
   npm run dev
   ```
   - Web UI: http://localhost:6248 (or `http://<your-machine-ip>:6248` from another device on the same network)
   - API: http://localhost:4000 (also reachable via the host IP)

4. **Accessing the API from other devices**  
   The frontend now points at `<protocol>//<host>:4000` by default, so when you open the web UI from another machine it will reach the API running on the same host. If the API sits behind a different host/port (e.g., tunnels or containers), override the base URL by creating `apps/web/.env.local` with `VITE_API_BASE_URL=http://your-api-host:port` (you can optionally set `VITE_API_PORT` instead of hardcoding `:4000` in the URL).

5. **Using the Photoshop plugin remotely**  
   The plugin’s connection field now accepts plain hosts/hosts+ports (e.g., `192.168.1.123:4000`); it will add `http://` automatically and strip trailing slashes before trying to connect. Enter the same address your API is listening on, hit **Connect**, and the plugin will access projects/assets on that machine over the LAN.

## Workspace data

- All generated projects, assets, and storyboard JSON files now live under `workspace-data/` in the repo root.
- Copying that single folder between machines moves every project, asset, and issue without hunting for hidden paths.
- The API automatically migrates older installs that previously stored data in `apps/api/output`.
- Feel free to keep `workspace-data/` out of git (already ignored) — just drag it along with the repo when switching PCs.

## Tech Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Express + TypeScript
- **AI:** Google Gemini 2.0 Flash (multimodal image generation)
- **Monorepo:** Turborepo with shared TypeScript packages

## Project Structure

```
apps/
  web/          # React frontend
  api/          # Express API server
packages/
  shared/       # Shared TypeScript types and utilities
```

## Documentation

See [project.md](./project.md) for detailed architecture, API documentation, and development guide.

## Scripts

- `npm run dev` - Start web and API in dev mode
- `npm run build` - Build all packages
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking
- `npm test` - Run tests

## Update Script

Windows users can use `update.bat` to safely pull the latest changes from GitHub (stashes local changes first).

## License

[Add your license here]
