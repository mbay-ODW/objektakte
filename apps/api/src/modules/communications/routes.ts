import { createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import {
  assignmentStatus,
  cases,
  communications,
  contacts,
  events,
  fundingCases,
} from "../../db/schema.js";
import { ErrorResponse, must } from "../../lib/errors.js";
import { createRouter, queryBool, UuidParam, ValidationError } from "../../lib/http.js";
import { getSetting, putSetting, settingSchemas } from "../../lib/settings.js";
import {
  AssignInput,
  assignCommunication,
  createLead,
  IngestMessage,
  ingestMessage,
  LeadInput,
  rematchOpen,
  setAssignmentStatus,
} from "./service.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const errors = {
  400: { description: "Ungültig", content: json(ValidationError) },
  404: { description: "Nicht gefunden", content: json(ErrorResponse) },
  422: { description: "Fachlich ungültig", content: json(ErrorResponse) },
};

const Communication = z
  .object({
    id: z.uuid(),
    caseId: z.uuid().nullable(),
    caseNumber: z.string().nullable(),
    contactId: z.uuid().nullable(),
    contactName: z.string().nullable(),
    channel: z.string(),
    direction: z.string(),
    occurredAt: z.string(),
    subject: z.string().nullable(),
    body: z.string().nullable(),
    author: z.string().nullable(),
    assignmentStatus: z.enum(assignmentStatus.enumValues),
    matchConfidence: z.number().nullable(),
    matchReason: z.string().nullable(),
    matchCandidates: z.array(z.object({ caseId: z.uuid(), number: z.string(), score: z.number() })),
    participants: z.array(
      z.object({ role: z.string(), address: z.string(), name: z.string().nullish() }),
    ),
    source: z.string().nullable(),
  })
  .openapi("Communication");

const columns = {
  id: communications.id,
  caseId: communications.caseId,
  caseNumber: cases.number,
  contactId: communications.contactId,
  contactName: contacts.displayName,
  channel: communications.channel,
  direction: communications.direction,
  occurredAt: communications.occurredAt,
  subject: communications.subject,
  body: communications.body,
  author: communications.author,
  assignmentStatus: communications.assignmentStatus,
  matchConfidence: communications.matchConfidence,
  matchReason: communications.matchReason,
  matchCandidates: communications.matchCandidates,
  participants: communications.participants,
  source: communications.source,
};

async function selectCommunications(db: DbOrTx, where: SQL | undefined, limit = 200, offset = 0) {
  const rows = await db
    .select(columns)
    .from(communications)
    .leftJoin(cases, eq(cases.id, communications.caseId))
    .leftJoin(contacts, eq(contacts.id, communications.contactId))
    .where(where)
    .orderBy(desc(communications.occurredAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    ...r,
    occurredAt: r.occurredAt.toISOString(),
    matchConfidence: r.matchConfidence === null ? null : Number(r.matchConfidence),
    matchCandidates: r.matchCandidates as z.infer<typeof Communication>["matchCandidates"],
    participants: r.participants as z.infer<typeof Communication>["participants"],
  }));
}

const loadOne = async (db: DbOrTx, id: string) =>
  must((await selectCommunications(db, eq(communications.id, id)))[0], "Nachricht");

const ingest = createRoute({
  method: "post",
  path: "/communications/ingest",
  operationId: "ingestCommunications",
  tags: ["Kommunikation"],
  summary:
    "Nachrichten aus Postfächern/Messengern übernehmen und automatisch Kontakt und Vorgang zuordnen (idempotent über source + sourceRef)",
  request: {
    body: {
      required: true,
      content: json(z.object({ messages: z.array(IngestMessage).min(1).max(500) })),
    },
  },
  responses: {
    200: {
      description: "Ergebnis je Nachricht",
      content: json(
        z.object({
          items: z.array(
            z.object({
              id: z.uuid(),
              duplicate: z.boolean(),
              assignmentStatus: z.string(),
              caseNumber: z.string().nullable(),
              reason: z.string().nullable(),
            }),
          ),
        }),
      ),
    },
    400: errors[400],
  },
});

const list = createRoute({
  method: "get",
  path: "/communications",
  operationId: "listCommunications",
  tags: ["Kommunikation"],
  summary: "Nachrichten filtern",
  request: {
    query: z.object({
      caseId: z.uuid().optional(),
      contactId: z.uuid().optional(),
      assignmentStatus: z.enum(assignmentStatus.enumValues).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: {
    200: { description: "Nachrichten", content: json(z.object({ items: z.array(Communication) })) },
  },
});

const inbox = createRoute({
  method: "get",
  path: "/communications/inbox",
  operationId: "communicationInbox",
  tags: ["Kommunikation"],
  summary: "Zuordnungs-Inbox: offene sowie automatisch zugeordnete, noch unbestätigte Nachrichten",
  request: { query: z.object({ includeAutomatic: queryBool(true) }) },
  responses: {
    200: {
      description: "Inbox",
      content: json(z.object({ open: z.array(Communication), automatic: z.array(Communication) })),
    },
  },
});

const assign = createRoute({
  method: "post",
  path: "/communications/{id}/assign",
  operationId: "assignCommunication",
  tags: ["Kommunikation"],
  summary: "Nachricht manuell einem Vorgang/Kontakt zuordnen (optional Absender als Kanal lernen)",
  request: { params: UuidParam, body: { required: true, content: json(AssignInput) } },
  responses: { 200: { description: "Zugeordnet", content: json(Communication) }, ...errors },
});

const confirm = createRoute({
  method: "post",
  path: "/communications/{id}/confirm",
  operationId: "confirmCommunication",
  tags: ["Kommunikation"],
  summary: "Automatische Zuordnung bestätigen",
  request: { params: UuidParam },
  responses: { 200: { description: "Bestätigt", content: json(Communication) }, ...errors },
});

const ignore = createRoute({
  method: "post",
  path: "/communications/{id}/ignore",
  operationId: "ignoreCommunication",
  tags: ["Kommunikation"],
  summary: "Nachricht ignorieren (z. B. Newsletter)",
  request: { params: UuidParam },
  responses: { 200: { description: "Ignoriert", content: json(Communication) }, ...errors },
});

const lead = createRoute({
  method: "post",
  path: "/communications/{id}/lead",
  operationId: "createLeadFromCommunication",
  tags: ["Kommunikation"],
  summary: "Aus einer Nachricht eine Anfrage anlegen (Kontakt inkl. Absenderkanal + Vorgang)",
  request: { params: UuidParam, body: { required: true, content: json(LeadInput) } },
  responses: {
    201: {
      description: "Angelegt",
      content: json(
        z.object({ contactId: z.uuid(), caseId: z.uuid(), communication: Communication }),
      ),
    },
    ...errors,
  },
});

const rematch = createRoute({
  method: "post",
  path: "/communications/rematch",
  operationId: "rematchCommunications",
  tags: ["Kommunikation"],
  summary: "Offene Nachrichten erneut automatisch zuordnen",
  responses: {
    200: {
      description: "Ergebnis",
      content: json(z.object({ checked: z.number(), assigned: z.number() })),
    },
  },
});

const TimelineItem = z
  .object({
    at: z.string(),
    kind: z.enum(["communication", "event"]),
    title: z.string(),
    detail: z.string().nullable(),
    refId: z.string(),
    type: z.string(),
  })
  .openapi("TimelineItem");

const timeline = createRoute({
  method: "get",
  path: "/timeline",
  operationId: "timeline",
  tags: ["Kommunikation"],
  summary: "Chronik eines Vorgangs oder Kontakts: Nachrichten und fachliche Ereignisse",
  request: {
    query: z.object({
      caseId: z.uuid().optional(),
      contactId: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(1000).default(200),
    }),
  },
  responses: {
    200: { description: "Chronik", content: json(z.object({ items: z.array(TimelineItem) })) },
    400: errors[400],
  },
});

const getSettings = createRoute({
  method: "get",
  path: "/settings/communication",
  operationId: "getCommunicationSettings",
  tags: ["Einstellungen"],
  summary: "Einstellungen der Zuordnung (eigene/ignorierte Adressen, Schwellwert)",
  responses: { 200: { description: "Einstellungen", content: json(settingSchemas.communication) } },
});

const putSettings = createRoute({
  method: "put",
  path: "/settings/communication",
  operationId: "putCommunicationSettings",
  tags: ["Einstellungen"],
  summary: "Einstellungen der Zuordnung speichern",
  request: { body: { required: true, content: json(settingSchemas.communication) } },
  responses: {
    200: { description: "Gespeichert", content: json(settingSchemas.communication) },
    400: errors[400],
  },
});

const EVENT_TITLES: Record<string, string> = {
  "case.created": "Vorgang angelegt",
  "case.updated": "Vorgang geändert",
  "case.status_changed": "Status geändert",
  "funding_case.created": "Förderfall angelegt",
  "funding_case.updated": "Förderfall geändert",
  "deadline.created": "Frist angelegt",
  "deadline.updated": "Frist geändert",
  "deadline.removed": "Frist entfallen",
};

export const communicationsRouter = createRouter()
  .openapi(ingest, async (c) => {
    const db = c.get("db");
    const actor = c.get("actor");
    const items = [];
    for (const msg of c.req.valid("json").messages) {
      // Jede Nachricht in eigener Transaktion: ein Fehler blockiert nicht den Rest des Stapels.
      const r = await db.transaction((tx) => ingestMessage(tx, msg, actor));
      const saved = await loadOne(db, r.id);
      items.push({
        id: r.id,
        duplicate: r.duplicate,
        assignmentStatus: saved.assignmentStatus,
        caseNumber: saved.caseNumber,
        reason: saved.matchReason,
      });
    }
    return c.json({ items }, 200);
  })
  .openapi(list, async (c) => {
    const q = c.req.valid("query");
    const filters: SQL[] = [];
    if (q.caseId) filters.push(eq(communications.caseId, q.caseId));
    if (q.contactId) filters.push(eq(communications.contactId, q.contactId));
    if (q.assignmentStatus) filters.push(eq(communications.assignmentStatus, q.assignmentStatus));
    const items = await selectCommunications(c.get("db"), and(...filters), q.limit, q.offset);
    return c.json({ items }, 200);
  })
  .openapi(inbox, async (c) => {
    const db = c.get("db");
    const open = await selectCommunications(db, eq(communications.assignmentStatus, "offen"));
    const automatic = c.req.valid("query").includeAutomatic
      ? await selectCommunications(db, eq(communications.assignmentStatus, "automatisch"))
      : [];
    return c.json({ open, automatic }, 200);
  })
  .openapi(assign, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    await db.transaction((tx) => assignCommunication(tx, id, c.req.valid("json"), c.get("actor")));
    return c.json(await loadOne(db, id), 200);
  })
  .openapi(confirm, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    await db.transaction((tx) => setAssignmentStatus(tx, id, "bestaetigt", c.get("actor")));
    return c.json(await loadOne(db, id), 200);
  })
  .openapi(ignore, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    await db.transaction((tx) => setAssignmentStatus(tx, id, "ignoriert", c.get("actor")));
    return c.json(await loadOne(db, id), 200);
  })
  .openapi(lead, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    const r = await db.transaction((tx) => createLead(tx, id, c.req.valid("json"), c.get("actor")));
    return c.json({ ...r, communication: await loadOne(db, id) }, 201);
  })
  .openapi(rematch, async (c) => {
    const db = c.get("db");
    const r = await db.transaction((tx) => rematchOpen(tx, c.get("actor")));
    return c.json(r, 200);
  })
  .openapi(timeline, async (c) => {
    const { caseId, contactId, limit } = c.req.valid("query");
    if (!caseId && !contactId) {
      return c.json(
        {
          error: "validation_failed" as const,
          problems: [{ path: "caseId", message: "caseId oder contactId angeben" }],
        },
        400,
      );
    }
    const db = c.get("db");
    const comms = await selectCommunications(
      db,
      caseId
        ? eq(communications.caseId, caseId)
        : eq(communications.contactId, contactId as string),
      limit,
    );
    const entityIds: string[] = [];
    if (caseId) {
      entityIds.push(caseId);
      const fcs = await db
        .select({ id: fundingCases.id })
        .from(fundingCases)
        .where(eq(fundingCases.caseId, caseId));
      entityIds.push(...fcs.map((f) => f.id));
    } else if (contactId) {
      entityIds.push(contactId);
      const own = await db
        .select({ id: cases.id })
        .from(cases)
        .where(eq(cases.customerId, contactId));
      entityIds.push(...own.map((o) => o.id));
    }
    const evs = await db
      .select()
      .from(events)
      .where(
        and(
          inArray(events.entityId, entityIds),
          or(...Object.keys(EVENT_TITLES).map((t) => eq(events.type, t))),
        ),
      )
      .orderBy(desc(events.id))
      .limit(limit);
    const items: z.infer<typeof TimelineItem>[] = [
      ...comms.map((m) => ({
        at: m.occurredAt,
        kind: "communication" as const,
        title: `${m.direction === "eingehend" ? "←" : m.direction === "ausgehend" ? "→" : "•"} ${m.channel}${m.subject ? `: ${m.subject}` : ""}`,
        detail: m.body ? m.body.slice(0, 500) : null,
        refId: m.id,
        type: `communication.${m.direction}`,
      })),
      ...evs.map((e) => ({
        at: e.occurredAt.toISOString(),
        kind: "event" as const,
        title: EVENT_TITLES[e.type] ?? e.type,
        detail: summarize(e.payload),
        refId: String(e.id),
        type: e.type,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
    return c.json({ items }, 200);
  })
  .openapi(getSettings, async (c) => c.json(await getSetting(c.get("db"), "communication"), 200))
  .openapi(putSettings, async (c) =>
    c.json(
      await putSetting(c.get("db"), "communication", c.req.valid("json"), c.get("actor")),
      200,
    ),
  );

function summarize(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.changes && typeof p.changes === "object") {
    return Object.entries(p.changes as Record<string, { from: unknown; to: unknown }>)
      .map(([k, v]) => `${k}: ${String(v.from ?? "–")} → ${String(v.to ?? "–")}`)
      .join(", ");
  }
  if (typeof p.title === "string") {
    return typeof p.dueDate === "string" ? `${p.title} (fällig ${p.dueDate})` : p.title;
  }
  return null;
}
