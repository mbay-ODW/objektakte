import { createHash } from "node:crypto";
import { z } from "@hono/zod-openapi";
import { and, asc, eq, lt } from "drizzle-orm";
import type { Services } from "../../adapters/index.js";
import type { Database, DbOrTx } from "../../db/client.js";
import {
  cases,
  communications,
  documents,
  inspectionCategory,
  inspectionItems,
  inspectionMedia,
  inspections,
  objects,
} from "../../db/schema.js";
import { DomainError } from "../../lib/errors.js";
import { recordEvents } from "../../lib/events.js";
import { renderProtocolHtml } from "./protocol.js";

const text = z.string().trim().min(1).nullish();

export const Participant = z.object({
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).nullish(),
  contactId: z.uuid().nullish(),
});

export const InspectionPut = z
  .object({
    objectId: z.uuid(),
    caseId: z.uuid().nullish(),
    title: z.string().trim().min(1),
    startedAt: z.iso.datetime({ offset: true }),
    participants: z.array(Participant).default([]),
    weather: text,
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    notes: text,
  })
  .openapi("InspectionPut");

export const ItemPut = z
  .object({
    category: z.enum(inspectionCategory.enumValues),
    label: z.string().trim().min(1),
    location: text,
    attributes: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .default({}),
    condition: z.enum(["gut", "mittel", "schlecht"]).nullish(),
    notes: text,
    sortOrder: z.number().int().default(0),
  })
  .openapi("InspectionItemPut");

const MAX_BYTES = { foto: 20 * 1024 * 1024, audio: 60 * 1024 * 1024 };

/** Zulässige Dateitypen (Whitelist; der Typ landet später u. a. in Data-URIs des Protokolls). */
export const ALLOWED_MIME = {
  foto: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  audio: ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav"],
} as const;

async function loadInspection(tx: DbOrTx, id: string) {
  const [row] = await tx.select().from(inspections).where(eq(inspections.id, id));
  return row;
}

async function assertEditable(tx: DbOrTx, id: string) {
  const row = await loadInspection(tx, id);
  if (!row) throw new DomainError(404, "Begehung nicht gefunden");
  if (row.finalizedAt) throw new DomainError(409, "Begehung ist abgeschlossen");
  return row;
}

export async function putInspection(
  tx: DbOrTx,
  id: string,
  input: z.infer<typeof InspectionPut>,
  actor: string,
) {
  const [obj] = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(eq(objects.id, input.objectId));
  if (!obj) throw new DomainError(422, "Objekt nicht gefunden");
  if (input.caseId) {
    const [k] = await tx.select({ id: cases.id }).from(cases).where(eq(cases.id, input.caseId));
    if (!k) throw new DomainError(422, "Vorgang nicht gefunden");
  }
  const values = {
    objectId: input.objectId,
    caseId: input.caseId ?? null,
    title: input.title,
    startedAt: new Date(input.startedAt),
    participants: input.participants,
    weather: input.weather ?? null,
    latitude: input.latitude == null ? null : String(input.latitude),
    longitude: input.longitude == null ? null : String(input.longitude),
    notes: input.notes ?? null,
  };
  const existing = await loadInspection(tx, id);
  if (existing?.finalizedAt) throw new DomainError(409, "Begehung ist abgeschlossen");
  if (existing) {
    await tx.update(inspections).set(values).where(eq(inspections.id, id));
  } else {
    await tx.insert(inspections).values({ id, ...values });
    await recordEvents(tx, [
      {
        entityType: "inspection",
        entityId: id,
        type: "inspection.started",
        actor,
        payload: { objectId: input.objectId, caseId: input.caseId ?? null, title: input.title },
      },
    ]);
  }
}

export async function putItem(
  tx: DbOrTx,
  inspectionId: string,
  itemId: string,
  input: z.infer<typeof ItemPut>,
  actor = "system",
) {
  await assertEditable(tx, inspectionId);
  const values = {
    inspectionId,
    category: input.category,
    label: input.label,
    location: input.location ?? null,
    attributes: input.attributes,
    condition: input.condition ?? null,
    notes: input.notes ?? null,
    sortOrder: input.sortOrder,
  };
  const [other] = await tx
    .select({ inspectionId: inspectionItems.inspectionId })
    .from(inspectionItems)
    .where(eq(inspectionItems.id, itemId));
  if (other && other.inspectionId !== inspectionId) {
    throw new DomainError(409, "Position gehört zu einer anderen Begehung");
  }
  await tx
    .insert(inspectionItems)
    .values({ id: itemId, ...values })
    .onConflictDoUpdate({ target: inspectionItems.id, set: values });
  await recordEvents(tx, [
    {
      entityType: "inspection",
      entityId: inspectionId,
      type: other ? "inspection.item_updated" : "inspection.item_added",
      actor,
      payload: { itemId, category: input.category, label: input.label },
    },
  ]);
}

export async function deleteItem(
  tx: DbOrTx,
  inspectionId: string,
  itemId: string,
  actor = "system",
) {
  await assertEditable(tx, inspectionId);
  const removed = await tx
    .delete(inspectionItems)
    .where(and(eq(inspectionItems.id, itemId), eq(inspectionItems.inspectionId, inspectionId)))
    .returning({ id: inspectionItems.id, label: inspectionItems.label });
  if (removed.length > 0) {
    await recordEvents(tx, [
      {
        entityType: "inspection",
        entityId: inspectionId,
        type: "inspection.item_removed",
        actor,
        payload: { itemId, label: removed[0]?.label },
      },
    ]);
  }
}

function slug(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "application/pdf": "pdf",
  "text/html": "html",
};

/** Ordner einer Begehung in der Dateiablage (bevorzugt der Objektordner). */
async function inspectionFolder(
  tx: DbOrTx,
  services: Services,
  inspection: typeof inspections.$inferSelect,
) {
  const [obj] = await tx.select().from(objects).where(eq(objects.id, inspection.objectId));
  const date = inspection.startedAt.toISOString().slice(0, 10);
  const leaf = `Begehung-${date}-${inspection.id.slice(0, 8)}`;
  if (obj?.storagePath) return `${obj.storagePath.replace(/\/$/, "")}/Begehungen/${leaf}`;
  const objFolder = `${slug(obj?.label ?? "objekt")}-${inspection.objectId.slice(0, 8)}`;
  return `${services.storageBasePath.replace(/\/$/, "")}/objekte/${objFolder}/${leaf}`;
}

export interface MediaUpload {
  kind: "foto" | "audio";
  itemId?: string | null;
  caption?: string | null;
  takenAt?: string | null;
  file: File;
}

export async function putMedia(
  db: Database,
  services: Services,
  inspectionId: string,
  mediaId: string,
  upload: MediaUpload,
  actor: string,
) {
  const [existing] = await db.select().from(inspectionMedia).where(eq(inspectionMedia.id, mediaId));
  if (existing) {
    if (existing.inspectionId !== inspectionId) {
      throw new DomainError(409, "Medium gehört zu einer anderen Begehung");
    }
    return { id: mediaId, duplicate: true };
  }
  const inspection = await assertEditable(db, inspectionId);
  // Parameter wie "; codecs=opus" abtrennen, dann gegen die Whitelist prüfen
  const mimeType = (upload.file.type || "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!(ALLOWED_MIME[upload.kind] as readonly string[]).includes(mimeType)) {
    throw new DomainError(
      422,
      upload.kind === "foto"
        ? "Foto muss JPEG, PNG, WebP oder HEIC sein"
        : "Nicht unterstütztes Audioformat",
    );
  }
  if (upload.file.size > MAX_BYTES[upload.kind]) {
    throw new DomainError(422, `Datei zu groß (max. ${MAX_BYTES[upload.kind] / 1024 / 1024} MB)`);
  }
  if (upload.itemId) {
    const [item] = await db
      .select({ id: inspectionItems.id })
      .from(inspectionItems)
      .where(
        and(eq(inspectionItems.id, upload.itemId), eq(inspectionItems.inspectionId, inspectionId)),
      );
    if (!item) throw new DomainError(422, "Position nicht gefunden");
  }

  // Datei zuerst ablegen; die Datenbank referenziert sie danach atomar.
  const bytes = new Uint8Array(await upload.file.arrayBuffer());
  const folder = await inspectionFolder(db, services, inspection);
  const filename = `${upload.kind}-${mediaId}.${EXT[mimeType] ?? "bin"}`;
  const stored = await services.storage.put(`${folder}/${filename}`, bytes, mimeType);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        objectId: inspection.objectId,
        caseId: inspection.caseId,
        title: upload.caption ?? filename,
        docClass: upload.kind === "foto" ? "foto" : "sprachnotiz",
        storage: stored.storage,
        location: stored.location,
        mimeType,
        sha256,
      })
      .onConflictDoUpdate({
        target: [documents.storage, documents.location],
        set: { sha256, mimeType },
      })
      .returning({ id: documents.id });
    if (!doc) throw new Error("Dokument konnte nicht angelegt werden");
    await tx.insert(inspectionMedia).values({
      id: mediaId,
      inspectionId,
      itemId: upload.itemId ?? null,
      kind: upload.kind,
      documentId: doc.id,
      mimeType,
      caption: upload.caption ?? null,
      takenAt: upload.takenAt ? new Date(upload.takenAt) : null,
      transcriptStatus: upload.kind === "audio" && services.transcriber ? "ausstehend" : "keins",
    });
    await recordEvents(tx, [
      {
        entityType: "inspection",
        entityId: inspectionId,
        type: "inspection.media_added",
        actor,
        payload: { mediaId, kind: upload.kind, itemId: upload.itemId ?? null },
      },
    ]);
  });
  return { id: mediaId, duplicate: false };
}

export async function deleteMedia(tx: DbOrTx, inspectionId: string, mediaId: string) {
  await assertEditable(tx, inspectionId);
  await tx
    .delete(inspectionMedia)
    .where(and(eq(inspectionMedia.id, mediaId), eq(inspectionMedia.inspectionId, inspectionId)));
}

export async function inspectionDetail(db: DbOrTx, id: string) {
  const row = await loadInspection(db, id);
  if (!row) return undefined;
  const items = await db
    .select()
    .from(inspectionItems)
    .where(eq(inspectionItems.inspectionId, id))
    .orderBy(asc(inspectionItems.sortOrder), asc(inspectionItems.createdAt));
  const media = await db
    .select()
    .from(inspectionMedia)
    .where(eq(inspectionMedia.inspectionId, id))
    .orderBy(asc(inspectionMedia.createdAt));
  return { ...row, items, media };
}

/** Kanonischer Inhalt für den Integritätsnachweis (ohne Zeitstempel der Datenhaltung). */
export function canonicalSnapshot(
  detail: NonNullable<Awaited<ReturnType<typeof inspectionDetail>>>,
) {
  return JSON.stringify({
    id: detail.id,
    objectId: detail.objectId,
    caseId: detail.caseId,
    title: detail.title,
    startedAt: detail.startedAt.toISOString(),
    endedAt: detail.endedAt?.toISOString() ?? null,
    participants: detail.participants,
    weather: detail.weather,
    notes: detail.notes,
    items: detail.items.map((i) => ({
      id: i.id,
      category: i.category,
      label: i.label,
      location: i.location,
      attributes: i.attributes,
      condition: i.condition,
      notes: i.notes,
    })),
    media: detail.media.map((m) => ({
      id: m.id,
      kind: m.kind,
      itemId: m.itemId,
      documentId: m.documentId,
    })),
  });
}

export async function finalizeInspection(
  db: Database,
  services: Services,
  id: string,
  endedAt: string | undefined,
  actor: string,
) {
  await db.transaction(async (tx) => {
    const row = await assertEditable(tx, id);
    const end = endedAt ? new Date(endedAt) : new Date();
    if (end < row.startedAt) throw new DomainError(422, "Ende liegt vor dem Beginn");
    await tx.update(inspections).set({ endedAt: end }).where(eq(inspections.id, id));
    const detail = await inspectionDetail(tx, id);
    if (!detail) throw new DomainError(404, "Begehung nicht gefunden");
    const hash = createHash("sha256").update(canonicalSnapshot(detail)).digest("hex");
    await tx
      .update(inspections)
      .set({ status: "abgeschlossen", finalizedAt: new Date(), contentHash: hash })
      .where(eq(inspections.id, id));
    // Eintrag in der Chronik des Vorgangs
    await tx.insert(communications).values({
      caseId: row.caseId,
      objectId: row.objectId,
      channel: "vor_ort",
      direction: "intern",
      occurredAt: row.startedAt,
      subject: `Begehung: ${row.title}`,
      body: summarize(detail),
      assignmentStatus: "bestaetigt",
      source: "begehung",
      sourceRef: id,
    });
    await recordEvents(tx, [
      {
        entityType: "inspection",
        entityId: id,
        type: "inspection.finalized",
        actor,
        payload: { contentHash: hash, items: detail.items.length, media: detail.media.length },
      },
    ]);
  });
  return renderProtocol(db, services, id, actor);
}

function summarize(detail: NonNullable<Awaited<ReturnType<typeof inspectionDetail>>>) {
  const lines = detail.items.map(
    (i) =>
      `- ${i.label}${i.location ? ` (${i.location})` : ""}${i.condition ? ` – Zustand ${i.condition}` : ""}`,
  );
  const photos = detail.media.filter((m) => m.kind === "foto").length;
  const audio = detail.media.filter((m) => m.kind === "audio").length;
  return [
    `${detail.items.length} Positionen, ${photos} Fotos, ${audio} Sprachnotizen`,
    ...lines,
  ].join("\n");
}

/**
 * Erzeugt das Begehungsprotokoll (PDF über den Renderer, sonst HTML) und legt es ab.
 * Kann wiederholt werden, falls der Renderer beim Abschluss nicht erreichbar war.
 */
export async function renderProtocol(db: Database, services: Services, id: string, actor: string) {
  const detail = await inspectionDetail(db, id);
  if (!detail) throw new DomainError(404, "Begehung nicht gefunden");
  if (!detail.finalizedAt) throw new DomainError(409, "Protokoll erst nach Abschluss");
  const [obj] = await db.select().from(objects).where(eq(objects.id, detail.objectId));
  const [kase] = detail.caseId
    ? await db.select().from(cases).where(eq(cases.id, detail.caseId))
    : [];

  const images = new Map<string, string>();
  for (const m of detail.media.filter((x) => x.kind === "foto")) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, m.documentId));
    if (!doc) continue;
    try {
      const bytes = await services.storage.get(doc.location);
      images.set(m.id, `data:${m.mimeType};base64,${Buffer.from(bytes).toString("base64")}`);
    } catch {
      // Bild fehlt in der Ablage – Protokoll trotzdem erzeugen
    }
  }
  const html = renderProtocolHtml({
    detail,
    object: obj ?? null,
    caseNumber: kase?.number ?? null,
    images,
  });

  let bytes: Uint8Array;
  let mimeType: string;
  let warning: string | null = null;
  if (services.pdf) {
    try {
      bytes = await services.pdf.htmlToPdf(html);
      mimeType = "application/pdf";
    } catch (err) {
      warning = `PDF-Erzeugung fehlgeschlagen, HTML abgelegt: ${err instanceof Error ? err.message : String(err)}`;
      bytes = new TextEncoder().encode(html);
      mimeType = "text/html";
    }
  } else {
    warning = "Kein PDF-Renderer konfiguriert, HTML abgelegt";
    bytes = new TextEncoder().encode(html);
    mimeType = "text/html";
  }
  const folder = await inspectionFolder(db, services, detail);
  const filename = `Begehungsprotokoll-${detail.startedAt.toISOString().slice(0, 10)}.${EXT[mimeType]}`;
  const stored = await services.storage.put(`${folder}/${filename}`, bytes, mimeType);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const docId = await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        objectId: detail.objectId,
        caseId: detail.caseId,
        title: filename,
        docClass: "begehungsprotokoll",
        storage: stored.storage,
        location: stored.location,
        mimeType,
        sha256,
      })
      .onConflictDoUpdate({
        target: [documents.storage, documents.location],
        set: { sha256, mimeType },
      })
      .returning({ id: documents.id });
    if (!doc) throw new Error("Protokoll konnte nicht abgelegt werden");
    await tx.update(inspections).set({ protocolDocumentId: doc.id }).where(eq(inspections.id, id));
    await recordEvents(tx, [
      {
        entityType: "inspection",
        entityId: id,
        type: "inspection.protocol_created",
        actor,
        payload: { documentId: doc.id, mimeType, warning },
      },
    ]);
    return doc.id;
  });
  return { documentId: docId, mimeType, warning };
}

/** Arbeitet ausstehende Transkriptionen ab (max. 3 Versuche je Sprachnotiz). */
export async function processTranscriptions(db: Database, services: Services, limit = 5) {
  if (!services.transcriber) return { processed: 0 };
  const pending = await db
    .select({ media: inspectionMedia, doc: documents })
    .from(inspectionMedia)
    .innerJoin(documents, eq(documents.id, inspectionMedia.documentId))
    .where(
      and(
        eq(inspectionMedia.transcriptStatus, "ausstehend"),
        lt(inspectionMedia.transcriptAttempts, 3),
      ),
    )
    .orderBy(asc(inspectionMedia.createdAt))
    .limit(limit);
  let processed = 0;
  for (const { media, doc } of pending) {
    const attempts = media.transcriptAttempts + 1;
    try {
      const audio = await services.storage.get(doc.location);
      const transcript = await services.transcriber.transcribe(
        audio,
        media.mimeType,
        doc.location.split("/").pop() ?? "audio",
      );
      await db.transaction(async (tx) => {
        await tx
          .update(inspectionMedia)
          .set({
            transcript,
            transcriptStatus: "fertig",
            transcriptError: null,
            transcriptAttempts: attempts,
          })
          .where(eq(inspectionMedia.id, media.id));
        await recordEvents(tx, [
          {
            entityType: "inspection",
            entityId: media.inspectionId,
            type: "inspection.transcribed",
            actor: "system",
            payload: { mediaId: media.id, itemId: media.itemId, length: transcript.length },
          },
        ]);
      });
      processed++;
    } catch (err) {
      await db
        .update(inspectionMedia)
        .set({
          transcriptAttempts: attempts,
          transcriptError: err instanceof Error ? err.message : String(err),
          transcriptStatus: attempts >= 3 ? "fehler" : "ausstehend",
        })
        .where(eq(inspectionMedia.id, media.id));
    }
  }
  return { processed };
}

/** Transkription erneut anstoßen (z. B. nach Fehlern). */
export async function retryTranscription(db: Database, services: Services, mediaId: string) {
  if (!services.transcriber) throw new DomainError(422, "Keine Transkription konfiguriert");
  const [m] = await db.select().from(inspectionMedia).where(eq(inspectionMedia.id, mediaId));
  if (m?.kind !== "audio") throw new DomainError(404, "Sprachnotiz nicht gefunden");
  await db
    .update(inspectionMedia)
    .set({ transcriptStatus: "ausstehend", transcriptAttempts: 0, transcriptError: null })
    .where(eq(inspectionMedia.id, mediaId));
}

export function startTranscriptionWorker(db: Database, services: Services, intervalMs: number) {
  let running = false;
  const timer = setInterval(async () => {
    if (running || !services.transcriber) return;
    running = true;
    try {
      await processTranscriptions(db, services);
    } catch (err) {
      console.error("Transkription fehlgeschlagen", err);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
