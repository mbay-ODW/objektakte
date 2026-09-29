/** Setzt die E2E-Datenbank vollständig zurück; die API spielt beim Start alle Migrationen ein. */
import { rm } from "node:fs/promises";
import postgres from "postgres";
import { E2E } from "./env";

const url = new URL(E2E.databaseUrl);
const dbName = url.pathname.slice(1);
// Schutz vor Verwechslung: nur ausdrücklich als Web-/E2E-Datenbank benannte Datenbanken leeren.
if (!/(web|e2e)/.test(dbName)) {
  throw new Error(`Datenbank "${dbName}" sieht nicht nach einer Testdatenbank aus – Abbruch.`);
}

const sql = postgres(E2E.databaseUrl, { max: 1, onnotice: () => {} });
try {
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql`DROP SCHEMA IF EXISTS public CASCADE`;
  await sql`CREATE SCHEMA public`;
} finally {
  await sql.end();
}
await rm(E2E.storageDir, { recursive: true, force: true });
console.log(`E2E-Datenbank ${dbName} zurückgesetzt`);
