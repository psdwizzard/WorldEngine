import path from "node:path";
import type { EnvConfig } from "../lib/env";
import { prepareDataRoot } from "../lib/dataRoot";
import { configureAssetStore } from "../services/assetStore";
import { initializeCharacterStore } from "../stores/characters";
import { initializePanelStore } from "../stores/panels";
import { createProject, initializeProjectStore, listProjects } from "../stores/projects";
import { DEFAULT_PROJECT_SLUG } from "../lib/constants";

export async function initializePersistence(env: EnvConfig) {
  const dataRoot = path.resolve(env.DATA_ROOT);
  await prepareDataRoot(dataRoot);
  await initializeProjectStore(dataRoot);
  const projects = listProjects();
  if (projects.length === 0) {
    await createProject({
      name: "Workspace",
      slug: DEFAULT_PROJECT_SLUG,
      description: "Default project",
    });
  }
  await configureAssetStore(dataRoot);
  await initializeCharacterStore(dataRoot);
  await initializePanelStore(dataRoot);
}
