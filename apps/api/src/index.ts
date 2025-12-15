import { createServer } from "./server";
import { loadEnv } from "./lib/env";
import { initializePersistence } from "./storage/persistence";

async function main() {
  const env = loadEnv();
  await initializePersistence(env);
  const app = createServer(env);

  app.listen(env.PORT, env.HOST, () => {
    console.log(`api:listening ${env.HOST}:${env.PORT}`);
  });
}

void main();