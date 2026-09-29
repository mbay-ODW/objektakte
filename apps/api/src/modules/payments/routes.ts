import { createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import {
  bankTransactions,
  bankTxStatus,
  billingDocuments,
  paymentAllocations,
} from "../../db/schema.js";
import { ErrorResponse } from "../../lib/errors.js";
import { createRouter, UuidParam, ValidationError } from "../../lib/http.js";
import { getSetting, putSetting, settingSchemas } from "../../lib/settings.js";
import { parseBankCsv } from "./csv.js";
import {
  applyAllocations,
  ignoreTransaction,
  importTransactions,
  loadReceivables,
  rematchTransactions,
  TransactionInput,
} from "./service.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const errors = {
  400: { description: "Ungültig", content: json(ValidationError) },
  404: { description: "Nicht gefunden", content: json(ErrorResponse) },
  422: { description: "Fachlich ungültig", content: json(ErrorResponse) },
};

const Allocation = z.object({
  billingDocumentId: z.uuid(),
  number: z.string().nullable(),
  amountCents: z.number().int(),
  source: z.enum(["automatisch", "manuell"]),
  reason: z.string().nullable(),
});

const BankTransaction = z
  .object({
    id: z.uuid(),
    account: z.string(),
    bookingDate: z.string(),
    valueDate: z.string().nullable(),
    amountCents: z.number().int(),
    currency: z.string(),
    counterpartyName: z.string().nullable(),
    counterpartyIban: z.string().nullable(),
    purpose: z.string().nullable(),
    status: z.enum(bankTxStatus.enumValues),
    suggestions: z.array(
      z.object({
        billingDocumentId: z.uuid(),
        number: z.string(),
        amountCents: z.number().int(),
        score: z.number(),
        reason: z.string(),
      }),
    ),
    allocations: z.array(Allocation),
  })
  .openapi("BankTransaction");

const ImportResult = z
  .object({
    received: z.number().int(),
    imported: z.number().int(),
    duplicates: z.number().int(),
    allocated: z.number().int(),
    errors: z.array(z.object({ line: z.number().int(), message: z.string() })),
  })
  .openapi("BankImportResult");

const Receivable = z
  .object({
    billingDocumentId: z.uuid(),
    type: z.string(),
    number: z.string().nullable(),
    issueDate: z.string().nullable(),
    dueDate: z.string().nullable(),
    grossCents: z.number().int(),
    paidCents: z.number().int(),
    openCents: z.number().int(),
    daysOverdue: z.number().int(),
    contactId: z.uuid(),
    contactName: z.string(),
    caseId: z.uuid().nullable(),
    caseNumber: z.string().nullable(),
  })
  .openapi("Receivable");

async function loadTransactions(
  db: Parameters<typeof loadReceivables>[0],
  where: SQL | undefined,
  limit = 500,
) {
  const rows = await db
    .select()
    .from(bankTransactions)
    .where(where)
    .orderBy(desc(bankTransactions.bookingDate), desc(bankTransactions.createdAt))
    .limit(limit);
  const ids = rows.map((r) => r.id);
  const allocs =
    ids.length === 0
      ? []
      : await db
          .select({ a: paymentAllocations, number: billingDocuments.number })
          .from(paymentAllocations)
          .innerJoin(
            billingDocuments,
            eq(billingDocuments.id, paymentAllocations.billingDocumentId),
          )
          .where(inArray(paymentAllocations.transactionId, ids));
  return rows.map((r) => ({
    id: r.id,
    account: r.account,
    bookingDate: r.bookingDate,
    valueDate: r.valueDate,
    amountCents: r.amountCents,
    currency: r.currency,
    counterpartyName: r.counterpartyName,
    counterpartyIban: r.counterpartyIban,
    purpose: r.purpose,
    status: r.status,
    suggestions: r.suggestions as z.infer<typeof BankTransaction>["suggestions"],
    allocations: allocs
      .filter((x) => x.a.transactionId === r.id)
      .map((x) => ({
        billingDocumentId: x.a.billingDocumentId,
        number: x.number,
        amountCents: x.a.amountCents,
        source: x.a.source,
        reason: x.a.reason,
      })),
  }));
}

const importJson = createRoute({
  method: "post",
  path: "/bank/transactions/import",
  operationId: "importBankTransactions",
  tags: ["Zahlungen"],
  summary: "Kontoumsätze übernehmen (JSON, z. B. aus einer Bank-API); doppelte werden erkannt",
  request: {
    body: {
      required: true,
      content: json(
        z.object({ account: z.string().min(1), transactions: z.array(TransactionInput).max(5000) }),
      ),
    },
  },
  responses: { 200: { description: "Ergebnis", content: json(ImportResult) }, 400: errors[400] },
});

const importCsv = createRoute({
  method: "post",
  path: "/bank/transactions/import-csv",
  operationId: "importBankCsv",
  tags: ["Zahlungen"],
  summary: "Kontoauszug als CSV übernehmen (Spaltenzuordnung siehe Einstellungen „bank“)",
  "x-mcp": false,
  request: {
    query: z.object({ account: z.string().min(1) }),
    body: { required: true, content: { "text/csv": { schema: z.string() } } },
  },
  responses: { 200: { description: "Ergebnis", content: json(ImportResult) }, 400: errors[400] },
});

const list = createRoute({
  method: "get",
  path: "/bank/transactions",
  operationId: "listBankTransactions",
  tags: ["Zahlungen"],
  summary: "Kontoumsätze mit Zuordnungen und Vorschlägen",
  request: {
    query: z.object({
      status: z.enum(bankTxStatus.enumValues).optional(),
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
    }),
  },
  responses: {
    200: { description: "Umsätze", content: json(z.object({ items: z.array(BankTransaction) })) },
  },
});

const allocate = createRoute({
  method: "post",
  path: "/bank/transactions/{id}/allocate",
  operationId: "allocateBankTransaction",
  tags: ["Zahlungen"],
  summary: "Umsatz manuell Rechnungen zuordnen (ersetzt bestehende Zuordnungen; leer = lösen)",
  request: {
    params: UuidParam,
    body: {
      required: true,
      content: json(
        z.object({
          allocations: z.array(
            z.object({ billingDocumentId: z.uuid(), amountCents: z.number().int().positive() }),
          ),
        }),
      ),
    },
  },
  responses: { 200: { description: "Zugeordnet", content: json(BankTransaction) }, ...errors },
});

const ignore = createRoute({
  method: "post",
  path: "/bank/transactions/{id}/ignore",
  operationId: "ignoreBankTransaction",
  tags: ["Zahlungen"],
  summary: "Umsatz ignorieren (z. B. Privateinlage, Umbuchung)",
  request: { params: UuidParam },
  responses: { 200: { description: "Ignoriert", content: json(BankTransaction) }, ...errors },
});

const rematch = createRoute({
  method: "post",
  path: "/bank/rematch",
  operationId: "rematchBankTransactions",
  tags: ["Zahlungen"],
  summary: "Offene Zahlungseingänge erneut abgleichen",
  responses: {
    200: {
      description: "Ergebnis",
      content: json(z.object({ checked: z.number(), allocated: z.number() })),
    },
  },
});

const receivables = createRoute({
  method: "get",
  path: "/receivables",
  operationId: "listReceivables",
  tags: ["Zahlungen"],
  summary: "Offene Posten (Rechnungen abzüglich zugeordneter Zahlungen)",
  request: {
    query: z.object({
      overdueOnly: z.coerce.boolean().default(false),
      today: z.iso.date().optional(),
    }),
  },
  responses: {
    200: {
      description: "Offene Posten",
      content: json(z.object({ items: z.array(Receivable), totalOpenCents: z.number().int() })),
    },
  },
});

const settingsGet = (key: "bank" | "datev", id: string) =>
  createRoute({
    method: "get",
    path: `/settings/${key}`,
    operationId: id,
    tags: ["Einstellungen"],
    summary: key === "bank" ? "Einstellungen Bankabgleich/CSV" : "Einstellungen DATEV-Export",
    responses: { 200: { description: "Einstellungen", content: json(settingSchemas[key]) } },
  });

const settingsPut = (key: "bank" | "datev", id: string) =>
  createRoute({
    method: "put",
    path: `/settings/${key}`,
    operationId: id,
    tags: ["Einstellungen"],
    summary:
      key === "bank"
        ? "Einstellungen Bankabgleich/CSV speichern"
        : "Einstellungen DATEV-Export speichern",
    request: { body: { required: true, content: json(settingSchemas[key]) } },
    responses: {
      200: { description: "Gespeichert", content: json(settingSchemas[key]) },
      400: errors[400],
    },
  });

const loadOne = async (db: Parameters<typeof loadReceivables>[0], id: string) =>
  (await loadTransactions(db, eq(bankTransactions.id, id)))[0];

export const paymentsRouter = createRouter()
  .openapi(importJson, async (c) => {
    const { account, transactions } = c.req.valid("json");
    const r = await c
      .get("db")
      .transaction((tx) => importTransactions(tx, account, transactions, c.get("actor")));
    return c.json({ ...r, errors: [] }, 200);
  })
  .openapi(importCsv, async (c) => {
    const { account } = c.req.valid("query");
    const text = await c.req.text();
    const db = c.get("db");
    const settings = await getSetting(db, "bank");
    const parsed = parseBankCsv(text, settings.csv);
    if (parsed.transactions.length === 0 && parsed.errors.length > 0) {
      return c.json(
        {
          error: "validation_failed" as const,
          problems: parsed.errors.map((e) => ({ path: `Zeile ${e.line}`, message: e.message })),
        },
        400,
      );
    }
    const r = await db.transaction((tx) =>
      importTransactions(
        tx,
        account,
        parsed.transactions.filter((t) => t.amountCents !== 0),
        c.get("actor"),
      ),
    );
    return c.json({ ...r, errors: parsed.errors }, 200);
  })
  .openapi(list, async (c) => {
    const { status, from, to } = c.req.valid("query");
    const filters: SQL[] = [];
    if (status) filters.push(eq(bankTransactions.status, status));
    if (from) filters.push(gte(bankTransactions.bookingDate, from));
    if (to) filters.push(lte(bankTransactions.bookingDate, to));
    return c.json({ items: await loadTransactions(c.get("db"), and(...filters)) }, 200);
  })
  .openapi(allocate, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.get("db");
    await db.transaction((tx) =>
      applyAllocations(tx, id, c.req.valid("json").allocations, "manuell", c.get("actor")),
    );
    const t = await loadOne(db, id);
    if (!t) return c.json({ error: "not_found", message: "Umsatz nicht gefunden" }, 404);
    return c.json(t, 200);
  })
  .openapi(ignore, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.get("db");
    await db.transaction((tx) => ignoreTransaction(tx, id, c.get("actor")));
    const t = await loadOne(db, id);
    if (!t) return c.json({ error: "not_found", message: "Umsatz nicht gefunden" }, 404);
    return c.json(t, 200);
  })
  .openapi(rematch, async (c) =>
    c.json(await c.get("db").transaction((tx) => rematchTransactions(tx, c.get("actor"))), 200),
  )
  .openapi(receivables, async (c) => {
    const { overdueOnly, today: t } = c.req.valid("query");
    const today = t ?? new Date().toISOString().slice(0, 10);
    const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
    const items = (await loadReceivables(c.get("db")))
      .map((r) => ({
        ...r,
        daysOverdue: r.dueDate && r.dueDate < today ? Math.round(day(today) - day(r.dueDate)) : 0,
      }))
      .filter((r) => !overdueOnly || r.daysOverdue > 0)
      .sort(
        (a, b) =>
          b.daysOverdue - a.daysOverdue || (a.issueDate ?? "").localeCompare(b.issueDate ?? ""),
      );
    return c.json({ items, totalOpenCents: items.reduce((s, r) => s + r.openCents, 0) }, 200);
  })
  .openapi(settingsGet("bank", "getBankSettings"), async (c) =>
    c.json(await getSetting(c.get("db"), "bank"), 200),
  )
  .openapi(settingsPut("bank", "putBankSettings"), async (c) =>
    c.json(await putSetting(c.get("db"), "bank", c.req.valid("json")), 200),
  )
  .openapi(settingsGet("datev", "getDatevSettings"), async (c) =>
    c.json(await getSetting(c.get("db"), "datev"), 200),
  )
  .openapi(settingsPut("datev", "putDatevSettings"), async (c) =>
    c.json(await putSetting(c.get("db"), "datev", c.req.valid("json")), 200),
  );
