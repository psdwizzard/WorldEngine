import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import type { EnvConfig } from "./lib/env";
import { hostedAuth, getHostedUser } from "./middleware/hostedAuth";
import { registerRoutes } from "./routes";
import { getAsset } from "./services/assetStore";
import { userOwnsProjectSlug } from "./stores/projects";

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const webDistDir = path.resolve(apiDir, "..", "..", "web", "dist");

export function createServer(env: EnvConfig) {
  const app = express();

  app.disable("x-powered-by");
  if (env.WORLDENGINE_HOSTED_BY_FORGE || env.WORLDENGINE_REQUIRE_AUTH) {
    app.use(cors({ origin: false }));
  } else {
    app.use(cors());
  }
  app.use(express.json({ limit: env.JSON_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.JSON_LIMIT }));
  app.use((_req, res, next) => {
    res.setHeader("cache-control", "no-store, max-age=0");
    res.setHeader("x-content-type-options", "nosniff");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  app.use(hostedAuth(env));

  app.get("/me", (req, res) => {
    const user = getHostedUser(req);
    res.json({ email: user.email, role: user.role });
  });

  // Serve built SPA static files (web/dist) BEFORE /assets/:assetId so
  // vite-hashed bundles like /assets/index-*.js resolve from disk instead of
  // being swallowed by the API asset-store route (which 404s when the path
  // isn't a known asset UUID).
  app.use(express.static(webDistDir));

  app.get("/assets/:assetId", (req, res) => {
    const asset = getAsset(req.params.assetId);
    if (!asset) {
      return res.status(404).json({ error: "asset_not_found" });
    }
    if (!userOwnsProjectSlug(getHostedUser(req).userKey, asset.meta.projectSlug)) {
      return res.status(404).json({ error: "asset_not_found" });
    }

    res.setHeader("Content-Type", asset.meta.mimeType);
    res.setHeader("Content-Length", asset.meta.size.toString());
    res.setHeader("Content-Disposition", `inline; filename="${asset.meta.originalName}"`);

    asset.stream.on("error", (error) => {
      console.error("asset:stream_error", error);
      // Only try to send error response if headers haven't been sent yet
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        // If headers already sent, destroy the connection
        res.destroy();
      }
    });

    asset.stream.pipe(res);
  });

  registerRoutes(app);

  app.get("*", (_req, res, next) => {
    res.sendFile(path.join(webDistDir, "index.html"), (error) => {
      if (error) next();
    });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
