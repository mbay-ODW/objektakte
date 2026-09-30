import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadEnv } from "../env.js";
import { createDb, type Database } from "./client.js";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(db: Database) {
  await migrate(db, { migrationsFolder });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, close } = createDb(loadEnv().DATABASE_URL);
  await runMigrations(db);
  await close();
  console.log("Migrationen angewendet.");
}
