import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import {
  billingDocuments,
  caseStatus,
  cases,
  communications,
  contacts,
  documents,
  measureTypes,
} from "../../db/schema.js";
import { createRouter, NotFound, Pagination, UuidParam } from "../../lib/http.js";

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
  tags: ["Vorgänge"],
  summary: "Leistungsarten",
  responses: {
    200: {
      description: "Leistungsarten",
      content: { "application/json": { schema: z.object({ items: z.array(MeasureType) }) } },
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
    const { id } = c.req.valid("param");
    const db = c.get("db");
    const [row] = await db
      .select(caseColumns)
      .from(cases)
      .innerJoin(contacts, eq(contacts.id, cases.customerId))
      .where(eq(cases.id, id));
    if (!row) return c.json({ error: "not_found" as const }, 404);

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

    return c.json(
      {
        ...row,
        communications: comms.map((m) => ({ ...m, occurredAt: m.occurredAt.toISOString() })),
        documents: docs,
        billingDocuments: billing,
      },
      200,
    );
  })
  .openapi(measureRoute, async (c) => {
    const items = await c.get("db").select().from(measureTypes).orderBy(asc(measureTypes.code));
    return c.json({ items }, 200);
  });
