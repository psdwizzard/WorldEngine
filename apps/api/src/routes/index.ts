import type { Express } from "express";
import { assetsRouter } from "./assets";
import { backupRouter } from "./backup";
import { charactersRouter } from "./characters";
import { itemsRouter } from "./items";
import { locationsRouter } from "./locations";
import { panelsRouter } from "./panels";
import { psRouter } from "./ps";
import { projectsRouter } from "./projects";

export function registerRoutes(app: Express) {
  app.use("/projects", projectsRouter);
  app.use("/characters", charactersRouter);
  app.use("/locations", locationsRouter);
  app.use("/items", itemsRouter);
  app.use("/panels", panelsRouter);
  app.use("/assets", assetsRouter);
  app.use("/ps", psRouter);
  app.use("/backup", backupRouter);
}
