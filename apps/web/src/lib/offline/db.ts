import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { CachedObject, LocalInspection, QueuedJob } from "./types";

export interface VorOrtSchema extends DBSchema {
  jobs: { key: number; value: QueuedJob; indexes: { byInspection: string } };
  inspections: { key: string; value: LocalInspection };
  objects: { key: string; value: CachedObject };
  /** Lokale Kopien von Fotos/Sprachnotizen für die Vorschau (bis zur Übertragung). */
  blobs: { key: string; value: { id: string; blob: Blob } };
  meta: { key: string; value: { key: string; value: unknown } };
}

export type VorOrtDb = IDBPDatabase<VorOrtSchema>;

export const DB_NAME = "objektakte-vor-ort";

export function openVorOrtDb(name = DB_NAME): Promise<VorOrtDb> {
  return openDB<VorOrtSchema>(name, 1, {
    upgrade(db) {
      const jobs = db.createObjectStore("jobs", { keyPath: "seq", autoIncrement: true });
      jobs.createIndex("byInspection", "payload.inspectionId");
      db.createObjectStore("inspections", { keyPath: "id" });
      db.createObjectStore("objects", { keyPath: "id" });
      db.createObjectStore("blobs", { keyPath: "id" });
      db.createObjectStore("meta", { keyPath: "key" });
    },
  });
}
