import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
await runMigrations(db);

const app = createApp({ db, apiToken: env.API_TOKEN });
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`objektakte API läuft auf Port ${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await close();
      process.exit(0);
    });
  });
}
