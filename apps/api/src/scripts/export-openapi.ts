/**
 * Schreibt die OpenAPI-Beschreibung in eine Datei, ohne Datenbankverbindung.
 * Aufruf: tsx src/scripts/export-openapi.ts [ziel.json]
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LocalStorage } from "../adapters/storage.js";
import { createApp } from "../app.js";
import { createDb } from "../db/client.js";

// createApp greift erst bei Anfragen auf die Datenbank zu; postgres.js verbindet sich lazy.
const { db, close } = createDb("postgres://unused:unused@127.0.0.1:1/unused");
const app = createApp({
  db,
  apiToken: "export-only-token",
  services: {
    storage: new LocalStorage("/nonexistent"),
    storageBasePath: "/objektakte",
    eInvoiceValidation: "internal",
  },
});

const res = await app.request("/openapi.json");
if (!res.ok) throw new Error(`OpenAPI-Export fehlgeschlagen: ${res.status}`);
const spec = await res.json();
const target = resolve(process.argv[2] ?? "openapi.json");
await writeFile(target, `${JSON.stringify(spec, null, 2)}\n`);
await close();
console.log(`OpenAPI geschrieben: ${target}`);
