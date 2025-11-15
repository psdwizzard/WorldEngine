import { Buffer } from "node:buffer";
import { rm } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { EnvConfig } from "./lib/env";
import { createServer } from "./server";
import { initializePersistence } from "./storage/persistence";

const testDataRoot = path.resolve(process.cwd(), "tmp", "test-data");

const env: EnvConfig = {
  NODE_ENV: "test",
  PORT: 0,
  HOST: "127.0.0.1",
  JSON_LIMIT_MB: 10,
  JSON_LIMIT: "10mb",
  DATA_ROOT: testDataRoot,
  GEMINI_API_KEY: undefined,
};

async function makeApp() {
  await rm(testDataRoot, { recursive: true, force: true });
  await initializePersistence(env);
  return createServer(env);
}

describe("createServer", () => {
  it("responds to health checks", async () => {
    const app = await makeApp();
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("stores character uploads", async () => {
    const app = await makeApp();

    const response = await request(app)
      .post("/characters/upload")
      .field("name", "Test Character")
      .field("angle", "front")
      .attach("source", Buffer.from("fake image"), {
        filename: "front.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(200);
    expect(response.body.character.name).toBe("Test Character");
    expect(response.body.asset.id).toBeDefined();
    expect(response.body.character.angles.front?.id).toBe(response.body.asset.id);
  });

  it("stubs generation into a new slot", async () => {
    const app = await makeApp();

    const uploadResponse = await request(app)
      .post("/characters/upload")
      .field("name", "Generator")
      .field("angle", "front")
      .attach("source", Buffer.from("front"), {
        filename: "front.png",
        contentType: "image/png",
      });

    const characterId: string = uploadResponse.body.character.id;
    const sourceSlotId: string = uploadResponse.body.slot.id;

    const generateResponse = await request(app)
      .post("/characters/generate/slot")
      .send({
        characterId,
        sourceSlotId,
        targetSlotId: "",
        label: "Side",
        angle: "side",
        prompt: "Turn sideways",
      });

    expect(generateResponse.status).toBe(200);
    expect(generateResponse.body.character.slots.length).toBeGreaterThan(1);
    expect(generateResponse.body.slot.label).toBe("Side");
    expect(generateResponse.body.character.angles.side?.id).toBeDefined();
    expect(generateResponse.body.status).toBe("generated");
  });

  it("persists storyboard layout updates", async () => {
    const app = await makeApp();

    const initial = await request(app).get("/panels/layout");
    expect(initial.status).toBe(200);
    expect(initial.body.page.panels.length).toBeGreaterThan(0);

    const page = initial.body.page;
    const firstPanel = { ...page.panels[0], geometry: { ...page.panels[0].geometry, x: 0.2, y: 0.15 } };
    const updatedPanels = [firstPanel, ...page.panels.slice(1)];

    const saveResponse = await request(app)
      .put("/panels/layout")
      .send({
        page: {
          ...page,
          label: "Updated Page",
          panels: updatedPanels,
        },
      });

    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body.page.label).toBe("Updated Page");
    expect(saveResponse.body.page.panels[0].geometry.x).toBeCloseTo(0.2, 5);

    const persisted = await request(app).get("/panels/layout");
    expect(persisted.body.page.label).toBe("Updated Page");
    expect(persisted.body.page.panels[0].geometry.x).toBeCloseTo(0.2, 5);
  });
});
