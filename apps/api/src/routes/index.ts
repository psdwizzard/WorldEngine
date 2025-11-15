import type { Express } from "express";
import { charactersRouter } from "./characters";
import { itemsRouter } from "./items";
import { locationsRouter } from "./locations";
import { panelsRouter } from "./panels";
import { projectsRouter } from "./projects";

export function registerRoutes(app: Express) {
  app.use("/projects", projectsRouter);
  app.use("/characters", charactersRouter);
  app.use("/locations", locationsRouter);
  app.use("/items", itemsRouter);
  app.use("/panels", panelsRouter);
}
