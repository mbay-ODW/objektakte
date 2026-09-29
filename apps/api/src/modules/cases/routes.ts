import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  billingDocuments,
  caseStatus,
  cases,
  communications,
  contacts,
  documents,
  measureTypes,
} from "../../db/schema.js";
import { ErrorResponse } from "../../lib/errors.js";
import { createRouter, NotFound, Pagination, UuidParam, ValidationError } from "../../lib/http.js";
import { CaseCreate, CasePatch, createCase, updateCase } from "./service.js";
import { recomputeCaseStatus } from "./status.js";

const Status = z.enum(caseStatus.enumValues);

export const Case = z
  .object({
    id: z.uuid(),
    number: z.string(),
    title: z.string(),
    customerId: z.uuid(),
    customerName: z.string(),
    objectId: z.uuid().nullable(),
    measureCode: z.string().nullable(),
    status: Status,
    statusOverridden: z.boolean(),
    openedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    storagePath: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .openapi("Case");

const CaseDetail = Case.extend({
  communications: z.array(
    z.object({
      id: z.uuid(),
      channel: z.string(),
      direction: z.string(),
      occurredAt: z.string(),
      subject: z.string().nullable(),
      body: z.string().nullable(),
      author: z.string().nullable(),
    }),
  ),
  documents: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      docClass: z.string().nullable(),
      storage: z.string(),
      location: z.string(),
    }),
  ),
  billingDocuments: z.array(
    z.object({
      id: z.uuid(),
      type: z.string(),
      number: z.string().nullable(),
      issueDate: z.string().nullable(),
      grossCents: z.number().int(),
      status: z.string(),
    }),
  ),
}).openapi("CaseDetail");

const MeasureType = z
  .object({
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    active: z.boolean(),
  })
  .openapi("MeasureType");

const caseColumns = {
  id: cases.id,
  number: cases.number,
  title: cases.title,
  customerId: cases.customerId,
  customerName: contacts.displayName,
  objectId: cases.objectId,
  measureCode: cases.measureCode,
  status: cases.status,
  statusOverridden: cases.statusOverridden,
  openedAt: cases.openedAt,
  closedAt: cases.closedAt,
  storagePath: cases.storagePath,
  notes: cases.notes,
};

const listRoute = createRoute({
  method: "get",
  path: "/cases",
  operationId: "listCases",
  tags: ["Vorgänge"],
  summary: "Vorgänge filtern/auflisten",
  request: {
    query: Pagination.extend({
      status: Status.optional(),
      measureCode: z.string().optional(),
      customerId: z.uuid().optional(),
      objectId: z.uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "Vorgänge",
      content: { "application/json": { schema: z.object({ items: z.array(Case) }) } },
    },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/cases/{id}",
  operationId: "getCase",
  tags: ["Vorgänge"],
  summary: "Vorgang mit Kommunikation, Dokumenten und Belegen",
  request: { params: UuidParam },
  responses: {
    200: { description: "Vorgang", content: { "application/json": { schema: CaseDetail } } },
    404: { description: "Nicht gefunden", content: { "application/json": { schema: NotFound } } },
  },
});

const measureRoute = createRoute({
  method: "get",
  path: "/measure-types",
  operationId: "listMeasureTypes",
  tags: ["Vorgänge"],
  summary: "Leistungsarten",
  responses: {
    200: {
      description: "Leistungsarten",
      content: { "application/json": { schema: z.object({ items: z.array(MeasureType) }) } },
    },
  },
});

const createDef = createRoute({
  method: "post",
  path: "/cases",
  operationId: "createCase",
  tags: ["Vorgänge"],
  summary: "Vorgang anlegen (Nummer wird bei Bedarf automatisch vergeben)",
  request: { body: { required: true, content: { "application/json": { schema: CaseCreate } } } },
  responses: {
    201: { description: "Angelegt", content: { "application/json": { schema: CaseDetail } } },
    400: { description: "Ungültig", content: { "application/json": { schema: ValidationError } } },
    409: {
      description: "Nummer vergeben",
      content: { "application/json": { schema: ErrorResponse } },
    },
    422: {
      description: "Fachlich ungültig",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const patchDef = createRoute({
  method: "patch",
  path: "/cases/{id}",
  operationId: "updateCase",
  tags: ["Vorgänge"],
  summary: "Vorgang ändern",
  request: {
    params: UuidParam,
    body: { required: true, content: { "application/json": { schema: CasePatch } } },
  },
  responses: {
    200: { description: "Geändert", content: { "application/json": { schema: CaseDetail } } },
    400: { description: "Ungültig", content: { "application/json": { schema: ValidationError } } },
    404: {
      description: "Nicht gefunden",
      content: { "application/json": { schema: ErrorResponse } },
    },
    422: {
      description: "Fachlich ungültig",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const autoStatusDef = createRoute({
  method: "post",
  path: "/cases/{id}/status/auto",
  operationId: "resetCaseStatusToAutomatic",
  tags: ["Vorgänge"],
  summary: "Manuelle Statusvorgabe aufheben und Status aus Belegen/Zahlungen ableiten",
  request: { params: UuidParam },
  responses: {
    200: { description: "Neu berechnet", content: { "application/json": { schema: CaseDetail } } },
    404: {
      description: "Nicht gefunden",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

export const casesRouter = createRouter()
  .openapi(listRoute, async (c) => {
    const { status, measureCode, customerId, objectId, limit, offset } = c.req.valid("query");
    const filters: SQL[] = [];
    if (status) filters.push(eq(cases.status, status));
    if (measureCode) filters.push(eq(cases.measureCode, measureCode));
    if (customerId) filters.push(eq(cases.customerId, customerId));
    if (objectId) filters.push(eq(cases.objectId, objectId));
    const rows = await c
      .get("db")
      .select(caseColumns)
      .from(cases)
      .innerJoin(contacts, eq(contacts.id, cases.customerId))
      .where(and(...filters))
      .orderBy(desc(cases.openedAt), asc(cases.number))
      .limit(limit)
      .offset(offset);
    return c.json({ items: rows }, 200);
  })
  .openapi(getRoute, async (c) => {
    const detail = await loadCaseDetail(c.get("db"), c.req.valid("param").id);
    if (!detail) return c.json({ error: "not_found" as const }, 404);
    return c.json(detail, 200);
  })
  .openapi(createDef, async (c) => {
    const db = c.get("db");
    const id = await db.transaction((tx) => createCase(tx, c.req.valid("json"), c.get("actor")));
    return c.json((await loadCaseDetail(db, id)) as z.infer<typeof CaseDetail>, 201);
  })
  .openapi(patchDef, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    await db.transaction((tx) => updateCase(tx, id, c.req.valid("json"), c.get("actor")));
    return c.json((await loadCaseDetail(db, id)) as z.infer<typeof CaseDetail>, 200);
  })
  .openapi(autoStatusDef, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    const found = await loadCaseDetail(db, id);
    if (!found) return c.json({ error: "not_found", message: "Vorgang nicht gefunden" }, 404);
    await db.transaction(async (tx) => {
      await tx.update(cases).set({ statusOverridden: false }).where(eq(cases.id, id));
      await recomputeCaseStatus(tx, id, c.get("actor"));
    });
    return c.json((await loadCaseDetail(db, id)) as z.infer<typeof CaseDetail>, 200);
  })
  .openapi(measureRoute, async (c) => {
    const items = await c.get("db").select().from(measureTypes).orderBy(asc(measureTypes.code));
    return c.json({ items }, 200);
  });

export async function loadCaseDetail(db: Database, id: string) {
  const [row] = await db
    .select(caseColumns)
    .from(cases)
    .innerJoin(contacts, eq(contacts.id, cases.customerId))
    .where(eq(cases.id, id));
  if (!row) return undefined;

  const [comms, docs, billing] = await Promise.all([
    db
      .select({
        id: communications.id,
        channel: communications.channel,
        direction: communications.direction,
        occurredAt: communications.occurredAt,
        subject: communications.subject,
        body: communications.body,
        author: communications.author,
      })
      .from(communications)
      .where(eq(communications.caseId, id))
      .orderBy(desc(communications.occurredAt))
      .limit(500),
    db
      .select({
        id: documents.id,
        title: documents.title,
        docClass: documents.docClass,
        storage: documents.storage,
        location: documents.location,
      })
      .from(documents)
      .where(eq(documents.caseId, id))
      .orderBy(asc(documents.title)),
    db
      .select({
        id: billingDocuments.id,
        type: billingDocuments.type,
        number: billingDocuments.number,
        issueDate: billingDocuments.issueDate,
        grossCents: billingDocuments.grossCents,
        status: billingDocuments.status,
      })
      .from(billingDocuments)
      .where(eq(billingDocuments.caseId, id))
      .orderBy(asc(billingDocuments.issueDate)),
  ]);

  return {
    ...row,
    communications: comms.map((m) => ({ ...m, occurredAt: m.occurredAt.toISOString() })),
    documents: docs,
    billingDocuments: billing,
  };
}
