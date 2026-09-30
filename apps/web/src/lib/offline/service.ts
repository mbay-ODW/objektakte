/**
 * Fachlogik der Offline-Begehung: lokaler Zustand in IndexedDB + Warteschlange.
 * Jede Änderung wird zuerst lokal gespeichert und dann als idempotenter Auftrag eingereiht.
 */
import type { VorOrtDb } from "./db";
import { type Sender, SyncQueue } from "./queue";
import type {
  CachedObject,
  InspectionPutBody,
  ItemPutBody,
  JobPayload,
  LocalInspection,
  LocalItem,
  LocalMedia,
  Participant,
} from "./types";

export interface ServiceOptions {
  newId?: () => string;
  now?: () => Date;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface StartInput {
  objectId: string;
  objectLabel: string;
  caseId: string | null;
  title: string;
  participants: Participant[];
  weather: string | null;
  notes: string | null;
}

export type ItemInput = Omit<LocalItem, "id" | "sortOrder"> & { id?: string };

export interface ServerInspection {
  id: string;
  objectId: string;
  caseId: string | null;
  title: string;
  status: "laufend" | "abgeschlossen";
  startedAt: string;
  participants: { name: string; role?: string | null }[];
  weather: string | null;
  notes: string | null;
  finalizedAt: string | null;
  protocolDocumentId: string | null;
  items: {
    id: string;
    category: LocalItem["category"];
    label: string;
    location: string | null;
    attributes: Record<string, unknown>;
    condition: string | null;
    notes: string | null;
    sortOrder: number;
  }[];
  media: {
    id: string;
    itemId: string | null;
    kind: "foto" | "audio";
    documentId: string;
    mimeType: string;
    caption: string | null;
    takenAt: string | null;
    transcriptStatus: "keins" | "ausstehend" | "fertig" | "fehler";
    transcript: string | null;
    transcriptError: string | null;
  }[];
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

/** MIME-Typ ohne Parameter ("audio/webm;codecs=opus" → "audio/webm"). */
export function baseMimeType(type: string): string {
  return (type.split(";")[0] ?? "").trim().toLowerCase() || "application/octet-stream";
}

export function mediaFilename(kind: "foto" | "audio", mediaId: string, mimeType: string): string {
  return `${kind}-${mediaId}.${EXTENSIONS[baseMimeType(mimeType)] ?? "bin"}`;
}

export class VorOrtService {
  readonly queue: SyncQueue;
  private readonly newId: () => string;
  private readonly now: () => Date;
  private listeners = new Set<() => void>();

  constructor(
    private readonly db: VorOrtDb,
    send: Sender,
    options: ServiceOptions = {},
  ) {
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.queue = new SyncQueue(db, send, {
      now: () => this.now().getTime(),
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
      onDone: (payload, result) => this.afterSync(payload, result),
    });
  }

  /** Benachrichtigt bei Änderungen am lokalen Datenbestand. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------------------
  // Objekte (Offline-Cache)
  // ---------------------------------------------------------------------------

  async cacheObjects(objects: CachedObject[]): Promise<void> {
    const tx = this.db.transaction("objects", "readwrite");
    await tx.store.clear();
    for (const o of objects) await tx.store.put(o);
    await tx.done;
    await this.db.put("meta", { key: "objectsCachedAt", value: this.now().toISOString() });
    this.changed();
  }

  async objects(): Promise<CachedObject[]> {
    const list = await this.db.getAll("objects");
    return list.sort((a, b) => a.label.localeCompare(b.label, "de"));
  }

  async objectsCachedAt(): Promise<string | null> {
    const row = await this.db.get("meta", "objectsCachedAt");
    return typeof row?.value === "string" ? row.value : null;
  }

  // ---------------------------------------------------------------------------
  // Begehungen
  // ---------------------------------------------------------------------------

  async inspections(): Promise<LocalInspection[]> {
    const list = await this.db.getAll("inspections");
    return list.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  inspection(id: string): Promise<LocalInspection | undefined> {
    return this.db.get("inspections", id);
  }

  private async save(inspection: LocalInspection) {
    await this.db.put("inspections", { ...inspection, updatedAt: this.now().getTime() });
    this.changed();
  }

  private async mustGet(id: string): Promise<LocalInspection> {
    const found = await this.inspection(id);
    if (!found) throw new Error("Begehung nicht gefunden");
    return found;
  }

  private assertEditable(inspection: LocalInspection) {
    if (inspection.status === "abgeschlossen") throw new Error("Begehung ist abgeschlossen");
  }

  private putBody(i: LocalInspection): InspectionPutBody {
    return {
      objectId: i.objectId,
      caseId: i.caseId,
      title: i.title,
      startedAt: i.startedAt,
      participants: i.participants.map((p) => ({ name: p.name, role: p.role ?? null })),
      weather: i.weather,
      notes: i.notes,
    };
  }

  async start(input: StartInput): Promise<LocalInspection> {
    const inspection: LocalInspection = {
      id: this.newId(),
      ...input,
      startedAt: this.now().toISOString(),
      items: [],
      media: [],
      status: "laufend",
      finalizedAt: null,
      protocolDocumentId: null,
      updatedAt: this.now().getTime(),
    };
    await this.save(inspection);
    await this.enqueue({
      type: "putInspection",
      inspectionId: inspection.id,
      body: this.putBody(inspection),
    });
    return inspection;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<LocalInspection, "title" | "participants" | "weather" | "notes" | "caseId">
    >,
  ): Promise<LocalInspection> {
    const current = await this.mustGet(id);
    this.assertEditable(current);
    const next = { ...current, ...patch };
    await this.save(next);
    await this.enqueue({ type: "putInspection", inspectionId: id, body: this.putBody(next) });
    return next;
  }

  async saveItem(inspectionId: string, input: ItemInput): Promise<LocalItem> {
    const current = await this.mustGet(inspectionId);
    this.assertEditable(current);
    const existing = input.id ? current.items.find((i) => i.id === input.id) : undefined;
    const item: LocalItem = {
      id: existing?.id ?? input.id ?? this.newId(),
      category: input.category,
      label: input.label,
      location: input.location,
      condition: input.condition,
      attributes: input.attributes,
      notes: input.notes,
      sortOrder: existing?.sortOrder ?? current.items.length,
    };
    const items = existing
      ? current.items.map((i) => (i.id === item.id ? item : i))
      : [...current.items, item];
    await this.save({ ...current, items });
    const body: ItemPutBody = {
      category: item.category,
      label: item.label,
      location: item.location,
      attributes: item.attributes,
      condition: item.condition,
      notes: item.notes,
      sortOrder: item.sortOrder,
    };
    await this.enqueue({ type: "putItem", inspectionId, itemId: item.id, body });
    return item;
  }

  async deleteItem(inspectionId: string, itemId: string): Promise<void> {
    const current = await this.mustGet(inspectionId);
    this.assertEditable(current);
    await this.save({
      ...current,
      items: current.items.filter((i) => i.id !== itemId),
      media: current.media.map((m) => (m.itemId === itemId ? { ...m, itemId: null } : m)),
    });
    await this.enqueue({ type: "deleteItem", inspectionId, itemId });
  }

  async addMedia(
    inspectionId: string,
    blob: Blob,
    meta: { kind: "foto" | "audio"; itemId: string | null; caption: string | null },
  ): Promise<LocalMedia> {
    const current = await this.mustGet(inspectionId);
    this.assertEditable(current);
    const mimeType = baseMimeType(blob.type);
    const typed = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
    const media: LocalMedia = {
      id: this.newId(),
      itemId: meta.itemId,
      kind: meta.kind,
      mimeType,
      caption: meta.caption,
      takenAt: this.now().toISOString(),
      size: typed.size,
      documentId: null,
      transcriptStatus: null,
      transcript: null,
      transcriptError: null,
    };
    await this.db.put("blobs", { id: media.id, blob: typed });
    await this.save({ ...current, media: [...current.media, media] });
    await this.enqueue({
      type: "putMedia",
      inspectionId,
      mediaId: media.id,
      meta: {
        kind: media.kind,
        itemId: media.itemId,
        caption: media.caption,
        takenAt: media.takenAt,
      },
      blob: typed,
      filename: mediaFilename(media.kind, media.id, mimeType),
    });
    return media;
  }

  /** Lokale Kopie eines Mediums (nur solange noch nicht übertragen). */
  async mediaBlob(mediaId: string): Promise<Blob | null> {
    return (await this.db.get("blobs", mediaId))?.blob ?? null;
  }

  /** Abschluss ist nur möglich, wenn alle Aufträge der Begehung übertragen sind. */
  async canFinalize(inspectionId: string): Promise<boolean> {
    const current = await this.inspection(inspectionId);
    if (!current || current.status === "abgeschlossen") return false;
    return (await this.queue.pendingCount(inspectionId)) === 0;
  }

  async finalize(inspectionId: string): Promise<void> {
    if (!(await this.canFinalize(inspectionId))) {
      throw new Error("Erst synchronisieren: Es sind noch Änderungen nicht übertragen.");
    }
    await this.queue.enqueue({
      type: "finalize",
      inspectionId,
      endedAt: this.now().toISOString(),
    });
    await this.queue.flush({ force: true });
  }

  /** Lokale Begehung entfernen (z. B. nach Abschluss). Offene Aufträge bleiben erhalten. */
  async forget(inspectionId: string): Promise<void> {
    const current = await this.inspection(inspectionId);
    if (!current) return;
    await this.db.delete("inspections", inspectionId);
    for (const m of current.media) await this.db.delete("blobs", m.id);
    this.changed();
  }

  // ---------------------------------------------------------------------------
  // Abgleich mit dem Server
  // ---------------------------------------------------------------------------

  private async enqueue(payload: JobPayload) {
    await this.queue.enqueue(payload);
  }

  private async afterSync(payload: JobPayload, result: unknown) {
    if (payload.type === "putMedia") {
      // Übertragene Datei nicht doppelt vorhalten.
      await this.db.delete("blobs", payload.mediaId);
      this.changed();
    }
    if (payload.type === "finalize") {
      const r = result as { inspection?: ServerInspection } | null;
      if (r?.inspection) await this.mergeServer(r.inspection);
      else {
        const current = await this.inspection(payload.inspectionId);
        if (current) await this.save({ ...current, status: "abgeschlossen" });
      }
    }
  }

  /**
   * Serverstand übernehmen: Status, Protokoll, Dokument-IDs und Transkripte. Lokal noch nicht
   * übertragene Positionen und Medien bleiben erhalten; unbekannte Begehungen werden importiert.
   */
  async mergeServer(server: ServerInspection, objectLabel?: string): Promise<LocalInspection> {
    const local = await this.inspection(server.id);
    const serverMedia = new Map(server.media.map((m) => [m.id, m]));
    const toLocalMedia = (m: ServerInspection["media"][number]): LocalMedia => ({
      id: m.id,
      itemId: m.itemId,
      kind: m.kind,
      mimeType: m.mimeType,
      caption: m.caption,
      takenAt: m.takenAt ?? server.startedAt,
      size: 0,
      documentId: m.documentId,
      transcriptStatus: m.transcriptStatus,
      transcript: m.transcript,
      transcriptError: m.transcriptError,
    });
    const toLocalItem = (i: ServerInspection["items"][number]): LocalItem => ({
      id: i.id,
      category: i.category,
      label: i.label,
      location: i.location,
      condition: (i.condition as LocalItem["condition"]) ?? null,
      attributes: Object.fromEntries(
        Object.entries(i.attributes).map(([k, v]) => [k, v == null ? "" : String(v)]),
      ),
      notes: i.notes,
      sortOrder: i.sortOrder,
    });

    let next: LocalInspection;
    if (!local) {
      next = {
        id: server.id,
        objectId: server.objectId,
        objectLabel: objectLabel ?? "",
        caseId: server.caseId,
        title: server.title,
        startedAt: server.startedAt,
        participants: server.participants.map((p) => ({ name: p.name, role: p.role ?? null })),
        weather: server.weather,
        notes: server.notes,
        items: server.items.map(toLocalItem),
        media: server.media.map(toLocalMedia),
        status: server.status,
        finalizedAt: server.finalizedAt,
        protocolDocumentId: server.protocolDocumentId,
        updatedAt: this.now().getTime(),
      };
    } else {
      const pendingJobs = await this.queue.pendingCount(server.id);
      const localMediaIds = new Set(local.media.map((m) => m.id));
      const media = [
        ...local.media.map((m) => {
          const s = serverMedia.get(m.id);
          return s ? { ...toLocalMedia(s), size: m.size, itemId: m.itemId } : m;
        }),
        ...server.media.filter((m) => !localMediaIds.has(m.id)).map(toLocalMedia),
      ];
      const localItemIds = new Set(local.items.map((i) => i.id));
      // Ohne ausstehende Aufträge ist der Server maßgeblich (z. B. Änderungen von anderem Gerät).
      const items =
        pendingJobs === 0
          ? server.items.map(toLocalItem)
          : [
              ...local.items,
              ...server.items.filter((i) => !localItemIds.has(i.id)).map(toLocalItem),
            ];
      next = {
        ...local,
        items,
        media,
        status: server.status,
        finalizedAt: server.finalizedAt,
        protocolDocumentId: server.protocolDocumentId,
      };
    }
    await this.save(next);
    return next;
  }
}
