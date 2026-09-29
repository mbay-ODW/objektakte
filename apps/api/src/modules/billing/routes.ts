import { createHash } from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import {
  articles,
  billingDocStatus,
  billingDocType,
  billingDocuments,
  contacts,
  documents,
  incomingInvoices,
} from "../../db/schema.js";
import { todayIso } from "../../lib/dates.js";
import { DomainError, ErrorResponse, must } from "../../lib/errors.js";
import { recordEvents } from "../../lib/events.js";
import { createRouter, UuidParam, ValidationError } from "../../lib/http.js";
import { getSetting, putSetting, settingSchemas } from "../../lib/settings.js";
import { loadReceivables } from "../payments/service.js";
import { parseIncomingFile } from "./incoming.js";
import { UNIT_CODES } from "./model.js";
import {
  cancelInvoice,
  convertDocument,
  createDraft,
  createReminder,
  DRAFT_TYPES,
  DraftCreate,
  DraftPatch,
  deleteDraft,
  finalizeDocument,
  loadLines,
  markSent,
  previewDocument,
  updateDraft,
} from "./service.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const errors = {
  400: { description: "Ungültig", content: json(ValidationError) },
  404: { description: "Nicht gefunden", content: json(ErrorResponse) },
  409: { description: "Zustand erlaubt das nicht", content: json(ErrorResponse) },
  422: { description: "Fachlich ungültig", content: json(ErrorResponse) },
};

const LineOut = z.object({
  position: z.number().int(),
  articleCode: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  quantity: z.number(),
  unitCode: z.string(),
  unitPriceCents: z.number().int(),
  taxCategory: z.enum(["S", "Z", "E", "AE", "O"]),
  taxRatePercent: z.number(),
});

const BillingDocument = z
  .object({
    id: z.uuid(),
    type: z.enum(billingDocType.enumValues),
    number: z.string().nullable(),
    status: z.enum(billingDocStatus.enumValues),
    source: z.enum(["nativ", "import"]),
    contactId: z.uuid(),
    contactName: z.string(),
    caseId: z.uuid().nullable(),
    issueDate: z.string().nullable(),
    dueDate: z.string().nullable(),
    serviceDate: z.string().nullable(),
    servicePeriodStart: z.string().nullable(),
    servicePeriodEnd: z.string().nullable(),
    buyerReference: z.string().nullable(),
    orderReference: z.string().nullable(),
    intro: z.string().nullable(),
    closing: z.string().nullable(),
    paymentTermsText: z.string().nullable(),
    currency: z.string(),
    netCents: z.number().int(),
    taxCents: z.number().int(),
    grossCents: z.number().int(),
    prepaidCents: z.number().int(),
    eInvoiceFormat: z.enum(["zugferd", "xrechnung", "keine"]),
    precedingDocumentId: z.uuid().nullable(),
    pdfDocumentId: z.uuid().nullable(),
    xmlDocumentId: z.uuid().nullable(),
    finalizedAt: z.string().nullable(),
    contentHash: z.string().nullable(),
    sentAt: z.string().nullable(),
    sentVia: z.string().nullable(),
    reminderLevel: z.number().int().nullable(),
    validation: z.unknown(),
    lines: z.array(LineOut),
  })
  .openapi("BillingDocument");

async function loadDoc(
  db: DbOrTx,
  id: string,
): Promise<z.infer<typeof BillingDocument> | undefined> {
  const [row] = await db
    .select({ d: billingDocuments, contactName: contacts.displayName })
    .from(billingDocuments)
    .innerJoin(contacts, eq(contacts.id, billingDocuments.contactId))
    .where(eq(billingDocuments.id, id));
  if (!row) return undefined;
  const d = row.d;
  return {
    id: d.id,
    type: d.type,
    number: d.number,
    status: d.status,
    source: d.source,
    contactId: d.contactId,
    contactName: row.contactName,
    caseId: d.caseId,
    issueDate: d.issueDate,
    dueDate: d.dueDate,
    serviceDate: d.serviceDate,
    servicePeriodStart: d.servicePeriodStart,
    servicePeriodEnd: d.servicePeriodEnd,
    buyerReference: d.buyerReference,
    orderReference: d.orderReference,
    intro: d.intro,
    closing: d.closing,
    paymentTermsText: d.paymentTermsText,
    currency: d.currency,
    netCents: d.netCents,
    taxCents: d.taxCents,
    grossCents: d.grossCents,
    prepaidCents: d.prepaidCents,
    eInvoiceFormat: d.eInvoiceFormat,
    precedingDocumentId: d.precedingDocumentId,
    pdfDocumentId: d.pdfDocumentId,
    xmlDocumentId: d.xmlDocumentId,
    finalizedAt: d.finalizedAt?.toISOString() ?? null,
    contentHash: d.contentHash,
    sentAt: d.sentAt?.toISOString() ?? null,
    sentVia: d.sentVia,
    reminderLevel: d.reminderLevel,
    validation: d.validation,
    lines: await loadLines(db, id),
  };
}

const one = async (db: DbOrTx, id: string) => must(await loadDoc(db, id), "Beleg");

const list = createRoute({
  method: "get",
  path: "/billing-documents",
  operationId: "listBillingDocuments",
  tags: ["Belege"],
  summary: "Belege (Angebote, Rechnungen, Mahnungen …) filtern",
  request: {
    query: z.object({
      type: z.enum(billingDocType.enumValues).optional(),
      status: z.enum(billingDocStatus.enumValues).optional(),
      caseId: z.uuid().optional(),
      contactId: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }),
  },
  responses: {
    200: {
      description: "Belege",
      content: json(
        z.object({ items: z.array(BillingDocument.omit({ lines: true, validation: true })) }),
      ),
    },
  },
});

const get = createRoute({
  method: "get",
  path: "/billing-documents/{id}",
  operationId: "getBillingDocument",
  tags: ["Belege"],
  summary: "Beleg mit Positionen und Prüfergebnis",
  request: { params: UuidParam },
  responses: { 200: { description: "Beleg", content: json(BillingDocument) }, 404: errors[404] },
});

const create = createRoute({
  method: "post",
  path: "/billing-documents",
  operationId: "createBillingDraft",
  tags: ["Belege"],
  summary:
    "Entwurf anlegen (Angebot, Auftragsbestätigung, Rechnung, Abschlags-/Schlussrechnung, Gutschrift)",
  request: { body: { required: true, content: json(DraftCreate) } },
  responses: { 201: { description: "Angelegt", content: json(BillingDocument) }, ...errors },
});

const patch = createRoute({
  method: "patch",
  path: "/billing-documents/{id}",
  operationId: "updateBillingDraft",
  tags: ["Belege"],
  summary: "Entwurf ändern (Positionen werden bei Angabe vollständig ersetzt)",
  request: { params: UuidParam, body: { required: true, content: json(DraftPatch) } },
  responses: { 200: { description: "Geändert", content: json(BillingDocument) }, ...errors },
});

const remove = createRoute({
  method: "delete",
  path: "/billing-documents/{id}",
  operationId: "deleteBillingDraft",
  tags: ["Belege"],
  summary: "Entwurf löschen (festgeschriebene Belege sind nicht löschbar)",
  request: { params: UuidParam },
  responses: { 204: { description: "Gelöscht" }, ...errors },
});

const preview = createRoute({
  method: "get",
  path: "/billing-documents/{id}/preview",
  operationId: "previewBillingDraft",
  tags: ["Belege"],
  summary: "PDF-Vorschau eines Entwurfs; Hinweise der Vorprüfung im Header X-Objektakte-Hinweise",
  "x-mcp": false,
  request: { params: UuidParam },
  responses: { 200: { description: "PDF" }, ...errors },
});

const check = createRoute({
  method: "get",
  path: "/billing-documents/{id}/check",
  operationId: "checkBillingDraft",
  tags: ["Belege"],
  summary: "Entwurf vorprüfen: Summen und fehlende Pflichtangaben für die E-Rechnung",
  request: { params: UuidParam },
  responses: {
    200: {
      description: "Ergebnis",
      content: json(
        z.object({
          netCents: z.number().int(),
          taxCents: z.number().int(),
          grossCents: z.number().int(),
          duePayableCents: z.number().int(),
          problems: z.array(z.object({ rule: z.string(), message: z.string() })),
        }),
      ),
    },
    ...errors,
  },
});

const finalize = createRoute({
  method: "post",
  path: "/billing-documents/{id}/finalize",
  operationId: "finalizeBillingDocument",
  tags: ["Belege"],
  summary:
    "Festschreiben: Nummer vergeben, E-Rechnung erzeugen und prüfen, PDF/A-3 ablegen. Danach unveränderlich (GoBD).",
  request: { params: UuidParam },
  responses: { 200: { description: "Festgeschrieben", content: json(BillingDocument) }, ...errors },
});

const cancel = createRoute({
  method: "post",
  path: "/billing-documents/{id}/cancel",
  operationId: "cancelInvoice",
  tags: ["Belege"],
  summary: "Rechnung stornieren (erzeugt und schreibt eine Stornorechnung fest)",
  request: { params: UuidParam },
  responses: {
    200: {
      description: "Storniert",
      content: json(z.object({ original: BillingDocument, storno: BillingDocument })),
    },
    ...errors,
  },
});

const convert = createRoute({
  method: "post",
  path: "/billing-documents/{id}/convert",
  operationId: "convertBillingDocument",
  tags: ["Belege"],
  summary: "Als neuen Entwurf übernehmen, z. B. Angebot → Rechnung",
  request: {
    params: UuidParam,
    body: { required: true, content: json(z.object({ type: z.enum(DRAFT_TYPES) })) },
  },
  responses: {
    201: { description: "Entwurf angelegt", content: json(BillingDocument) },
    ...errors,
  },
});

const sent = createRoute({
  method: "post",
  path: "/billing-documents/{id}/sent",
  operationId: "markBillingDocumentSent",
  tags: ["Belege"],
  summary: "Als versendet markieren",
  request: {
    params: UuidParam,
    body: {
      required: true,
      content: json(
        z.object({ via: z.string().trim().min(1).max(100).openapi({ example: "E-Mail" }) }),
      ),
    },
  },
  responses: { 200: { description: "Versendet", content: json(BillingDocument) }, ...errors },
});

const reminder = createRoute({
  method: "post",
  path: "/billing-documents/{id}/reminder",
  operationId: "createPaymentReminder",
  tags: ["Belege"],
  summary: "Zahlungserinnerung/Mahnung zu einer offenen Rechnung erzeugen",
  request: {
    params: UuidParam,
    body: {
      required: true,
      content: json(
        z.object({
          level: z.number().int().min(1).max(3).default(1),
          feeCents: z.number().int().min(0).max(100_00).default(0),
          dueDays: z.number().int().min(1).max(60).default(10),
        }),
      ),
    },
  },
  responses: { 201: { description: "Erzeugt", content: json(BillingDocument) }, ...errors },
});

const Article = z
  .object({
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    unitCode: z.string(),
    unitPriceCents: z.number().int(),
    taxCategory: z.enum(["S", "Z", "E", "AE", "O"]),
    taxRatePercent: z.number(),
    active: z.boolean(),
  })
  .openapi("Article");

const listArticles = createRoute({
  method: "get",
  path: "/articles",
  operationId: "listArticles",
  tags: ["Belege"],
  summary: "Artikel/Leistungen",
  responses: {
    200: { description: "Artikel", content: json(z.object({ items: z.array(Article) })) },
  },
});

const putArticle = createRoute({
  method: "put",
  path: "/articles/{code}",
  operationId: "upsertArticle",
  tags: ["Belege"],
  summary: "Artikel/Leistung anlegen oder ändern",
  request: {
    params: z.object({
      code: z
        .string()
        .regex(/^[A-Za-z0-9._-]{1,40}$/)
        .openapi({ param: { name: "code", in: "path" } }),
    }),
    body: {
      required: true,
      content: json(
        z.object({
          name: z.string().trim().min(1),
          description: z.string().nullish(),
          unitCode: z
            .string()
            .refine((u) => u in UNIT_CODES, "Einheit unbekannt")
            .default("C62"),
          unitPriceCents: z.number().int(),
          taxCategory: z.enum(["S", "Z", "E", "AE", "O"]).default("S"),
          taxRatePercent: z.number().min(0).max(100).default(19),
          active: z.boolean().default(true),
        }),
      ),
    },
  },
  responses: { 200: { description: "Gespeichert", content: json(Article) }, 400: errors[400] },
});

const companyGet = createRoute({
  method: "get",
  path: "/settings/company",
  operationId: "getCompanySettings",
  tags: ["Einstellungen"],
  summary: "Firmendaten, Nummernkreis-Muster und Standardtexte für Belege",
  responses: { 200: { description: "Firmendaten", content: json(settingSchemas.company) } },
});

const companyPut = createRoute({
  method: "put",
  path: "/settings/company",
  operationId: "putCompanySettings",
  tags: ["Einstellungen"],
  summary: "Firmendaten speichern (wirken nur auf künftig festgeschriebene Belege)",
  request: { body: { required: true, content: json(settingSchemas.company) } },
  responses: {
    200: { description: "Gespeichert", content: json(settingSchemas.company) },
    400: errors[400],
  },
});

const IncomingInvoice = z
  .object({
    id: z.uuid(),
    documentId: z.uuid().nullable(),
    syntax: z.string(),
    typeCode: z.string().nullable(),
    number: z.string(),
    issueDate: z.string().nullable(),
    dueDate: z.string().nullable(),
    sellerName: z.string().nullable(),
    sellerVatId: z.string().nullable(),
    buyerReference: z.string().nullable(),
    currency: z.string(),
    netCents: z.number().int().nullable(),
    taxCents: z.number().int().nullable(),
    grossCents: z.number().int().nullable(),
    payableCents: z.number().int().nullable(),
    iban: z.string().nullable(),
    status: z.enum(["offen", "geprueft", "bezahlt", "abgelehnt"]),
  })
  .openapi("IncomingInvoice");

const toIncoming = (r: typeof incomingInvoices.$inferSelect): z.infer<typeof IncomingInvoice> => ({
  id: r.id,
  documentId: r.documentId,
  syntax: r.syntax,
  typeCode: r.typeCode,
  number: r.number,
  issueDate: r.issueDate,
  dueDate: r.dueDate,
  sellerName: r.sellerName,
  sellerVatId: r.sellerVatId,
  buyerReference: r.buyerReference,
  currency: r.currency,
  netCents: r.netCents,
  taxCents: r.taxCents,
  grossCents: r.grossCents,
  payableCents: r.payableCents,
  iban: r.iban,
  status: r.status,
});

const uploadIncoming = createRoute({
  method: "post",
  path: "/incoming-invoices",
  operationId: "uploadIncomingInvoice",
  tags: ["Eingangsrechnungen"],
  summary: "E-Rechnung empfangen (XRechnung/ZUGFeRD als XML oder PDF) und auslesen",
  "x-mcp": false,
  request: {
    query: z.object({ filename: z.string().min(1).max(200).optional() }),
    body: {
      required: true,
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
    },
  },
  responses: {
    201: { description: "Übernommen", content: json(IncomingInvoice) },
    200: { description: "Bereits vorhanden", content: json(IncomingInvoice) },
    ...errors,
  },
});

const listIncoming = createRoute({
  method: "get",
  path: "/incoming-invoices",
  operationId: "listIncomingInvoices",
  tags: ["Eingangsrechnungen"],
  summary: "Eingangsrechnungen",
  request: {
    query: z.object({ status: z.enum(["offen", "geprueft", "bezahlt", "abgelehnt"]).optional() }),
  },
  responses: {
    200: {
      description: "Eingangsrechnungen",
      content: json(z.object({ items: z.array(IncomingInvoice) })),
    },
  },
});

const patchIncoming = createRoute({
  method: "patch",
  path: "/incoming-invoices/{id}",
  operationId: "updateIncomingInvoice",
  tags: ["Eingangsrechnungen"],
  summary: "Status einer Eingangsrechnung setzen",
  request: {
    params: UuidParam,
    body: {
      required: true,
      content: json(z.object({ status: z.enum(["offen", "geprueft", "bezahlt", "abgelehnt"]) })),
    },
  },
  responses: { 200: { description: "Geändert", content: json(IncomingInvoice) }, ...errors },
});

export const billingRouter = createRouter()
  .openapi(list, async (c) => {
    const q = c.req.valid("query");
    const filters: SQL[] = [];
    if (q.type) filters.push(eq(billingDocuments.type, q.type));
    if (q.status) filters.push(eq(billingDocuments.status, q.status));
    if (q.caseId) filters.push(eq(billingDocuments.caseId, q.caseId));
    if (q.contactId) filters.push(eq(billingDocuments.contactId, q.contactId));
    const db = c.get("db");
    const rows = await db
      .select({ id: billingDocuments.id })
      .from(billingDocuments)
      .where(and(...filters))
      .orderBy(desc(billingDocuments.issueDate), desc(billingDocuments.createdAt))
      .limit(q.limit);
    const items = [];
    for (const r of rows) {
      const { lines: _l, validation: _v, ...rest } = await one(db, r.id);
      items.push(rest);
    }
    return c.json({ items }, 200);
  })
  .openapi(get, async (c) => c.json(await one(c.get("db"), c.req.valid("param").id), 200))
  .openapi(create, async (c) => {
    const db = c.get("db");
    const id = await db.transaction((tx) => createDraft(tx, c.req.valid("json"), c.get("actor")));
    return c.json(await one(db, id), 201);
  })
  .openapi(patch, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    await db.transaction((tx) => updateDraft(tx, id, c.req.valid("json"), c.get("actor")));
    return c.json(await one(db, id), 200);
  })
  .openapi(remove, async (c) => {
    await c.get("db").transaction((tx) => deleteDraft(tx, c.req.valid("param").id, c.get("actor")));
    return c.body(null, 204);
  })
  .openapi(preview, async (c) => {
    const r = await previewDocument(c.get("db"), c.req.valid("param").id);
    return c.body(Buffer.from(r.pdf), 200, {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="entwurf.pdf"',
      "x-objektakte-hinweise": encodeURIComponent(
        r.violations.map((v) => `${v.message} [${v.rule}]`).join("; "),
      ),
    });
  })
  .openapi(check, async (c) => {
    const r = await previewDocument(c.get("db"), c.req.valid("param").id);
    return c.json(
      {
        netCents: r.totals.lineTotalCents,
        taxCents: r.totals.taxCents,
        grossCents: r.totals.grandTotalCents,
        duePayableCents: r.totals.duePayableCents,
        problems: r.violations,
      },
      200,
    );
  })
  .openapi(finalize, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    await finalizeDocument(db, c.get("services"), id, c.get("actor"));
    return c.json(await one(db, id), 200);
  })
  .openapi(cancel, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    const r = await cancelInvoice(db, c.get("services"), id, c.get("actor"));
    return c.json({ original: await one(db, id), storno: await one(db, r.stornoId) }, 200);
  })
  .openapi(convert, async (c) => {
    const db = c.get("db");
    const newId = await db.transaction((tx) =>
      convertDocument(tx, c.req.valid("param").id, c.req.valid("json").type, c.get("actor")),
    );
    return c.json(await one(db, newId), 201);
  })
  .openapi(sent, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    await db.transaction((tx) => markSent(tx, id, c.req.valid("json").via, c.get("actor")));
    return c.json(await one(db, id), 200);
  })
  .openapi(reminder, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const open = (await loadReceivables(db)).find((r) => r.billingDocumentId === id);
    if (!open) throw new DomainError(422, "Rechnung ist nicht offen");
    const r = await createReminder(
      db,
      c.get("services"),
      id,
      {
        level: body.level,
        feeCents: body.feeCents,
        openCents: open.openCents,
        dueDays: body.dueDays,
      },
      c.get("actor"),
    );
    return c.json(await one(db, r.id), 201);
  })
  .openapi(listArticles, async (c) => {
    const rows = await c.get("db").select().from(articles).orderBy(asc(articles.code));
    return c.json(
      { items: rows.map((a) => ({ ...a, taxRatePercent: Number(a.taxRatePercent) })) },
      200,
    );
  })
  .openapi(putArticle, async (c) => {
    const { code } = c.req.valid("param") as { code: string };
    const b = c.req.valid("json");
    const values = {
      code,
      name: b.name,
      description: b.description ?? null,
      unitCode: b.unitCode,
      unitPriceCents: b.unitPriceCents,
      taxCategory: b.taxCategory,
      taxRatePercent: String(b.taxCategory === "S" ? b.taxRatePercent : 0),
      active: b.active,
    };
    const [row] = await c
      .get("db")
      .insert(articles)
      .values(values)
      .onConflictDoUpdate({ target: articles.code, set: values })
      .returning();
    const a = must(row, "Artikel");
    return c.json({ ...a, taxRatePercent: Number(a.taxRatePercent) }, 200);
  })
  .openapi(companyGet, async (c) => c.json(await getSetting(c.get("db"), "company"), 200))
  .openapi(companyPut, async (c) =>
    c.json(await putSetting(c.get("db"), "company", c.req.valid("json")), 200),
  )
  .openapi(uploadIncoming, async (c) => {
    const db = c.get("db");
    const services = c.get("services");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) {
      throw new DomainError(422, "Datei fehlt oder ist größer als 25 MB");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const [existing] = await db
      .select()
      .from(incomingInvoices)
      .where(eq(incomingInvoices.sha256, sha256));
    if (existing) return c.json(toIncoming(existing), 200);
    let parsed: Awaited<ReturnType<typeof parseIncomingFile>>;
    try {
      parsed = await parseIncomingFile(bytes);
    } catch (err) {
      throw new DomainError(
        422,
        `Keine lesbare E-Rechnung: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const ext = parsed.kind === "pdf" ? "pdf" : "xml";
    const safeName = (c.req.valid("query").filename ?? `${parsed.parsed.number}.${ext}`).replace(
      /[^\w.\- äöüÄÖÜß]/g,
      "_",
    );
    const year = (parsed.parsed.issueDate ?? todayIso()).slice(0, 4);
    const stored = await services.storage.put(
      `${services.storageBasePath.replace(/\/$/, "")}/eingang/${year}/${sha256.slice(0, 8)}-${safeName}`,
      bytes,
      parsed.kind === "pdf" ? "application/pdf" : "application/xml",
    );
    const row = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({
          title: safeName,
          docClass: "eingangsrechnung",
          storage: stored.storage,
          location: stored.location,
          mimeType: parsed.kind === "pdf" ? "application/pdf" : "application/xml",
          sha256,
        })
        .onConflictDoUpdate({ target: [documents.storage, documents.location], set: { sha256 } })
        .returning({ id: documents.id });
      const [inv] = await tx
        .insert(incomingInvoices)
        .values({ ...parsed.parsed, documentId: doc?.id ?? null, sha256 })
        .returning();
      const saved = must(inv, "Eingangsrechnung");
      await recordEvents(tx, [
        {
          entityType: "incoming_invoice",
          entityId: saved.id,
          type: "incoming_invoice.received",
          actor: c.get("actor"),
          payload: { number: saved.number, seller: saved.sellerName, grossCents: saved.grossCents },
        },
      ]);
      return saved;
    });
    return c.json(toIncoming(row), 201);
  })
  .openapi(listIncoming, async (c) => {
    const { status } = c.req.valid("query");
    const rows = await c
      .get("db")
      .select()
      .from(incomingInvoices)
      .where(status ? eq(incomingInvoices.status, status) : undefined)
      .orderBy(desc(incomingInvoices.issueDate));
    return c.json({ items: rows.map(toIncoming) }, 200);
  })
  .openapi(patchIncoming, async (c) => {
    const [row] = await c
      .get("db")
      .update(incomingInvoices)
      .set({ status: c.req.valid("json").status })
      .where(eq(incomingInvoices.id, c.req.valid("param").id))
      .returning();
    if (!row) throw new DomainError(404, "Eingangsrechnung nicht gefunden");
    return c.json(toIncoming(row), 200);
  });
