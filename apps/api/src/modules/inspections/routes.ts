import { createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { inspectionCategory, inspections } from "../../db/schema.js";
import { ErrorResponse, must } from "../../lib/errors.js";
import { createRouter, UuidParam, ValidationError } from "../../lib/http.js";
import {
  deleteItem,
  deleteMedia,
  finalizeInspection,
  InspectionPut,
  ItemPut,
  inspectionDetail,
  putInspection,
  putItem,
  putMedia,
  renderProtocol,
  retryTranscription,
} from "./service.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const errors = {
  400: { description: "Ungültig", content: json(ValidationError) },
  404: { description: "Nicht gefunden", content: json(ErrorResponse) },
  409: { description: "Abgeschlossen/Konflikt", content: json(ErrorResponse) },
  422: { description: "Fachlich ungültig", content: json(ErrorResponse) },
};
const idParams = (...names: string[]) =>
  z.object(
    Object.fromEntries(names.map((n) => [n, z.uuid().openapi({ param: { name: n, in: "path" } })])),
  );

const Item = z
  .object({
    id: z.uuid(),
    category: z.enum(inspectionCategory.enumValues),
    label: z.string(),
    location: z.string().nullable(),
    attributes: z.record(z.string(), z.unknown()),
    condition: z.string().nullable(),
    notes: z.string().nullable(),
    sortOrder: z.number().int(),
  })
  .openapi("InspectionItem");

const Media = z
  .object({
    id: z.uuid(),
    itemId: z.uuid().nullable(),
    kind: z.enum(["foto", "audio"]),
    documentId: z.uuid(),
    mimeType: z.string(),
    caption: z.string().nullable(),
    takenAt: z.string().nullable(),
    transcriptStatus: z.enum(["keins", "ausstehend", "fertig", "fehler"]),
    transcript: z.string().nullable(),
    transcriptError: z.string().nullable(),
  })
  .openapi("InspectionMedia");

const Inspection = z
  .object({
    id: z.uuid(),
    objectId: z.uuid(),
    caseId: z.uuid().nullable(),
    title: z.string(),
    status: z.enum(["laufend", "abgeschlossen"]),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    participants: z.array(
      z.object({ name: z.string(), role: z.string().nullish(), contactId: z.string().nullish() }),
    ),
    weather: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    notes: z.string().nullable(),
    finalizedAt: z.string().nullable(),
    contentHash: z.string().nullable(),
    protocolDocumentId: z.uuid().nullable(),
  })
  .openapi("Inspection");

const InspectionDetail = Inspection.extend({ items: z.array(Item), media: z.array(Media) }).openapi(
  "InspectionDetail",
);

type Row = typeof inspections.$inferSelect;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toInspection = (r: Row): z.infer<typeof Inspection> => ({
  id: r.id,
  objectId: r.objectId,
  caseId: r.caseId,
  title: r.title,
  status: r.status,
  startedAt: r.startedAt.toISOString(),
  endedAt: iso(r.endedAt),
  participants: r.participants as z.infer<typeof Inspection>["participants"],
  weather: r.weather,
  latitude: r.latitude === null ? null : Number(r.latitude),
  longitude: r.longitude === null ? null : Number(r.longitude),
  notes: r.notes,
  finalizedAt: iso(r.finalizedAt),
  contentHash: r.contentHash,
  protocolDocumentId: r.protocolDocumentId,
});

async function detailJson(db: Parameters<typeof inspectionDetail>[0], id: string) {
  const d = must(await inspectionDetail(db, id), "Begehung");
  return {
    ...toInspection(d),
    items: d.items.map((i) => ({ ...i, attributes: i.attributes as Record<string, unknown> })),
    media: d.media.map((m) => ({
      id: m.id,
      itemId: m.itemId,
      kind: m.kind,
      documentId: m.documentId,
      mimeType: m.mimeType,
      caption: m.caption,
      takenAt: iso(m.takenAt),
      transcriptStatus: m.transcriptStatus,
      transcript: m.transcript,
      transcriptError: m.transcriptError,
    })),
  };
}

const list = createRoute({
  method: "get",
  path: "/inspections",
  operationId: "listInspections",
  tags: ["Begehungen"],
  summary: "Begehungen je Objekt oder Vorgang",
  request: { query: z.object({ objectId: z.uuid().optional(), caseId: z.uuid().optional() }) },
  responses: {
    200: { description: "Begehungen", content: json(z.object({ items: z.array(Inspection) })) },
  },
});

const get = createRoute({
  method: "get",
  path: "/inspections/{id}",
  operationId: "getInspection",
  tags: ["Begehungen"],
  summary: "Begehung mit Positionen, Medien und Transkripten",
  request: { params: UuidParam },
  responses: {
    200: { description: "Begehung", content: json(InspectionDetail) },
    404: errors[404],
  },
});

const put = createRoute({
  method: "put",
  path: "/inspections/{id}",
  operationId: "putInspection",
  tags: ["Begehungen"],
  summary: "Begehung anlegen oder aktualisieren (ID vom Client, idempotent)",
  request: { params: UuidParam, body: { required: true, content: json(InspectionPut) } },
  responses: { 200: { description: "Gespeichert", content: json(InspectionDetail) }, ...errors },
});

const putItemRoute = createRoute({
  method: "put",
  path: "/inspections/{id}/items/{itemId}",
  operationId: "putInspectionItem",
  tags: ["Begehungen"],
  summary: "Position (Bauteil, Anlage, Zone) anlegen oder aktualisieren",
  request: { params: idParams("id", "itemId"), body: { required: true, content: json(ItemPut) } },
  responses: { 200: { description: "Gespeichert", content: json(Item) }, ...errors },
});

const deleteItemRoute = createRoute({
  method: "delete",
  path: "/inspections/{id}/items/{itemId}",
  operationId: "deleteInspectionItem",
  tags: ["Begehungen"],
  summary: "Position löschen",
  request: { params: idParams("id", "itemId") },
  responses: { 204: { description: "Gelöscht" }, ...errors },
});

const MediaForm = z.object({
  file: z.any().openapi({ type: "string", format: "binary" }),
  kind: z.enum(["foto", "audio"]),
  itemId: z.uuid().optional(),
  caption: z.string().optional(),
  takenAt: z.iso.datetime({ offset: true }).optional(),
});

const putMediaRoute = createRoute({
  method: "put",
  path: "/inspections/{id}/media/{mediaId}",
  operationId: "putInspectionMedia",
  tags: ["Begehungen"],
  summary: "Foto oder Sprachnotiz hochladen (multipart, idempotent über die Medien-ID)",
  "x-mcp": false,
  request: {
    params: idParams("id", "mediaId"),
    body: { required: true, content: { "multipart/form-data": { schema: MediaForm } } },
  },
  responses: {
    200: {
      description: "Gespeichert",
      content: json(z.object({ id: z.uuid(), duplicate: z.boolean() })),
    },
    ...errors,
  },
});

const deleteMediaRoute = createRoute({
  method: "delete",
  path: "/inspections/{id}/media/{mediaId}",
  operationId: "deleteInspectionMedia",
  tags: ["Begehungen"],
  summary: "Medium entfernen (Datei bleibt in der Ablage)",
  request: { params: idParams("id", "mediaId") },
  responses: { 204: { description: "Entfernt" }, ...errors },
});

const retryRoute = createRoute({
  method: "post",
  path: "/inspection-media/{id}/transcribe",
  operationId: "retryTranscription",
  tags: ["Begehungen"],
  summary: "Transkription einer Sprachnotiz erneut anstoßen",
  request: { params: UuidParam },
  responses: { 202: { description: "Eingeplant" }, ...errors },
});

const finalizeRoute = createRoute({
  method: "post",
  path: "/inspections/{id}/finalize",
  operationId: "finalizeInspection",
  tags: ["Begehungen"],
  summary: "Begehung abschließen: festschreiben, Protokoll erzeugen, Eintrag in der Chronik",
  request: {
    params: UuidParam,
    body: {
      required: false,
      content: json(z.object({ endedAt: z.iso.datetime({ offset: true }).optional() })),
    },
  },
  responses: {
    200: {
      description: "Abgeschlossen",
      content: json(
        z.object({
          inspection: InspectionDetail,
          protocol: z.object({
            documentId: z.uuid(),
            mimeType: z.string(),
            warning: z.string().nullable(),
          }),
        }),
      ),
    },
    ...errors,
  },
});

const protocolRoute = createRoute({
  method: "post",
  path: "/inspections/{id}/protocol",
  operationId: "renderInspectionProtocol",
  tags: ["Begehungen"],
  summary: "Protokoll einer abgeschlossenen Begehung neu erzeugen",
  request: { params: UuidParam },
  responses: {
    200: {
      description: "Erzeugt",
      content: json(
        z.object({ documentId: z.uuid(), mimeType: z.string(), warning: z.string().nullable() }),
      ),
    },
    ...errors,
  },
});

export const inspectionsRouter = createRouter()
  .openapi(list, async (c) => {
    const { objectId, caseId } = c.req.valid("query");
    const filters: SQL[] = [];
    if (objectId) filters.push(eq(inspections.objectId, objectId));
    if (caseId) filters.push(eq(inspections.caseId, caseId));
    const rows = await c
      .get("db")
      .select()
      .from(inspections)
      .where(and(...filters))
      .orderBy(desc(inspections.startedAt));
    return c.json({ items: rows.map(toInspection) }, 200);
  })
  .openapi(get, async (c) => c.json(await detailJson(c.get("db"), c.req.valid("param").id), 200))
  .openapi(put, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    await db.transaction((tx) => putInspection(tx, id, c.req.valid("json"), c.get("actor")));
    return c.json(await detailJson(db, id), 200);
  })
  .openapi(putItemRoute, async (c) => {
    const db = c.get("db");
    const { id, itemId } = c.req.valid("param") as { id: string; itemId: string };
    const body = c.req.valid("json");
    await db.transaction((tx) => putItem(tx, id, itemId, body));
    const d = await detailJson(db, id);
    return c.json(
      must(
        d.items.find((i) => i.id === itemId),
        "Position",
      ),
      200,
    );
  })
  .openapi(deleteItemRoute, async (c) => {
    const { id, itemId } = c.req.valid("param") as { id: string; itemId: string };
    await c.get("db").transaction((tx) => deleteItem(tx, id, itemId));
    return c.body(null, 204);
  })
  .openapi(putMediaRoute, async (c) => {
    const { id, mediaId } = c.req.valid("param") as { id: string; mediaId: string };
    const form = c.req.valid("form");
    if (!(form.file instanceof File)) {
      return c.json(
        {
          error: "validation_failed" as const,
          problems: [{ path: "file", message: "Datei fehlt" }],
        },
        400,
      );
    }
    const r = await putMedia(
      c.get("db"),
      c.get("services"),
      id,
      mediaId,
      {
        kind: form.kind,
        itemId: form.itemId,
        caption: form.caption,
        takenAt: form.takenAt,
        file: form.file,
      },
      c.get("actor"),
    );
    return c.json(r, 200);
  })
  .openapi(deleteMediaRoute, async (c) => {
    const { id, mediaId } = c.req.valid("param") as { id: string; mediaId: string };
    await c.get("db").transaction((tx) => deleteMedia(tx, id, mediaId));
    return c.body(null, 204);
  })
  .openapi(retryRoute, async (c) => {
    await retryTranscription(c.get("db"), c.get("services"), c.req.valid("param").id);
    return c.body(null, 202);
  })
  .openapi(finalizeRoute, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    let endedAt: string | undefined;
    if (c.req.header("content-type")?.includes("application/json")) {
      endedAt = (c.req.valid("json") as { endedAt?: string } | undefined)?.endedAt;
    }
    const protocol = await finalizeInspection(db, c.get("services"), id, endedAt, c.get("actor"));
    return c.json({ inspection: await detailJson(db, id), protocol }, 200);
  })
  .openapi(protocolRoute, async (c) => {
    const r = await renderProtocol(
      c.get("db"),
      c.get("services"),
      c.req.valid("param").id,
      c.get("actor"),
    );
    return c.json(r, 200);
  });
