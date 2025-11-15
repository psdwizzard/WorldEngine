import cors from "cors";
import express from "express";
import type { EnvConfig } from "./lib/env";
import { registerRoutes } from "./routes";
import { getAsset } from "./services/assetStore";

export function createServer(env: EnvConfig) {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: env.JSON_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.JSON_LIMIT }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  app.get("/assets/:assetId", (req, res) => {
    const asset = getAsset(req.params.assetId);
    if (!asset) {
      return res.status(404).json({ error: "asset_not_found" });
    }

    res.setHeader("Content-Type", asset.meta.mimeType);
    res.setHeader("Content-Length", asset.meta.size.toString());
    res.setHeader("Content-Disposition", `inline; filename="${asset.meta.originalName}"`);

    asset.stream.on("error", (error) => {
      console.error("asset:stream_error", error);
      res.status(500).end();
    });

    asset.stream.pipe(res);
  });

  registerRoutes(app);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}