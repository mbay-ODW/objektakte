/** Datenmodell der Offline-Erfassung „Vor Ort“ (unabhängig vom UI-Framework). */
import type { components } from "../api/schema";

type Schemas = components["schemas"];
export type InspectionPutBody = Schemas["InspectionPut"];
export type ItemPutBody = Schemas["InspectionItemPut"];
export type InspectionCategory = ItemPutBody["category"];
export type Condition = NonNullable<ItemPutBody["condition"]>;

export interface MediaMeta {
  kind: "foto" | "audio";
  itemId: string | null;
  caption: string | null;
  takenAt: string;
}

/** Ein Auftrag der Warteschlange; alle Aufträge sind idempotent (Client-IDs, PUT). */
export type JobPayload =
  | { type: "putInspection"; inspectionId: string; body: InspectionPutBody }
  | { type: "putItem"; inspectionId: string; itemId: string; body: ItemPutBody }
  | { type: "deleteItem"; inspectionId: string; itemId: string }
  | {
      type: "putMedia";
      inspectionId: string;
      mediaId: string;
      meta: MediaMeta;
      blob: Blob;
      filename: string;
    }
  | { type: "finalize"; inspectionId: string; endedAt: string };

export interface QueuedJob {
  /** Laufende Nummer, bestimmt die Reihenfolge (autoIncrement). */
  seq?: number;
  payload: JobPayload;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** Frühester Zeitpunkt für den nächsten Versuch (ms seit Epoche). */
  nextAttemptAt: number;
  /** Dauerhaft fehlgeschlagen (z. B. Validierungsfehler); blockiert die Begehung bis zur Klärung. */
  failed: boolean;
}

export type SendOutcome =
  | { ok: true; result?: unknown }
  | { ok: false; retry: boolean; error: string };

export interface LocalItem {
  id: string;
  category: InspectionCategory;
  label: string;
  location: string | null;
  condition: Condition | null;
  attributes: Record<string, string>;
  notes: string | null;
  sortOrder: number;
}

export interface LocalMedia {
  id: string;
  itemId: string | null;
  kind: "foto" | "audio";
  mimeType: string;
  caption: string | null;
  takenAt: string;
  size: number;
  /** Serverseitige Dokument-ID, sobald bekannt. */
  documentId: string | null;
  transcriptStatus: "keins" | "ausstehend" | "fertig" | "fehler" | null;
  transcript: string | null;
  transcriptError: string | null;
}

export interface Participant {
  name: string;
  role?: string | null;
}

export interface LocalInspection {
  id: string;
  objectId: string;
  objectLabel: string;
  caseId: string | null;
  title: string;
  startedAt: string;
  participants: Participant[];
  weather: string | null;
  notes: string | null;
  items: LocalItem[];
  media: LocalMedia[];
  status: "laufend" | "abgeschlossen";
  finalizedAt: string | null;
  protocolDocumentId: string | null;
  updatedAt: number;
}

export interface CachedObject {
  id: string;
  label: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  cases: { id: string; number: string; title: string; status: string }[];
}
