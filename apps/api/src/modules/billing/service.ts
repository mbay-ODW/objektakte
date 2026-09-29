import { createHash } from "node:crypto";
import { z } from "@hono/zod-openapi";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Services } from "../../adapters/index.js";
import type { Database, DbOrTx } from "../../db/client.js";
import {
  articles,
  billingDocuments,
  billingLines,
  cases,
  contactChannels,
  contacts,
  documents,
} from "../../db/schema.js";
import { addDays, todayIso } from "../../lib/dates.js";
import { DomainError } from "../../lib/errors.js";
import { recordEvents } from "../../lib/events.js";
import { nextNumber } from "../../lib/sequences.js";
import { getSetting, type SettingValue } from "../../lib/settings.js";
import { recomputeCaseStatus } from "../cases/status.js";
import { buildCii, type CiiProfile } from "./cii.js";
import {
  type CanonicalInvoice,
  computeTotals,
  type InvoiceKind,
  type Line,
  type Party,
  type TaxCategory,
  UNIT_CODES,
} from "./model.js";
import { type DocumentView, renderDocumentPdf } from "./pdf.js";
import { checkInvoice } from "./rules.js";

type Company = SettingValue<"company">;
type Doc = typeof billingDocuments.$inferSelect;
type DocType = Doc["type"];

export const DRAFT_TYPES = [
  "angebot",
  "auftragsbestaetigung",
  "rechnung",
  "abschlagsrechnung",
  "schlussrechnung",
  "gutschrift",
] as const;
const INVOICE_KINDS = [
  "rechnung",
  "abschlagsrechnung",
  "schlussrechnung",
  "stornorechnung",
  "gutschrift",
] as const;
const isInvoiceKind = (t: DocType): t is InvoiceKind =>
  (INVOICE_KINDS as readonly string[]).includes(t);

export const TITLES: Record<DocType, string> = {
  angebot: "Angebot",
  auftragsbestaetigung: "Auftragsbestätigung",
  rechnung: "Rechnung",
  abschlagsrechnung: "Abschlagsrechnung",
  schlussrechnung: "Schlussrechnung",
  stornorechnung: "Stornorechnung",
  gutschrift: "Gutschrift",
  zahlungserinnerung: "Zahlungserinnerung",
  zahlungsbestaetigung: "Zahlungsbestätigung",
};

const SMALL_BUSINESS_NOTE = "Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.";

export const LineInput = z
  .object({
    articleCode: z.string().trim().min(1).nullish(),
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).nullish(),
    quantity: z.number().refine((q) => q !== 0 && Math.abs(q) < 1e9, "Menge ungültig"),
    unitCode: z
      .string()
      .refine((u) => u in UNIT_CODES, "Einheit unbekannt")
      .optional(),
    unitPriceCents: z.number().int().optional(),
    taxCategory: z.enum(["S", "Z", "E", "AE", "O"]).optional(),
    taxRatePercent: z.number().min(0).max(100).optional(),
  })
  .openapi("BillingLineInput");

const draftFields = {
  caseId: z.uuid().nullish(),
  issueDate: z.iso.date().nullish(),
  dueDate: z.iso.date().nullish(),
  serviceDate: z.iso.date().nullish(),
  servicePeriodStart: z.iso.date().nullish(),
  servicePeriodEnd: z.iso.date().nullish(),
  buyerReference: z.string().trim().min(1).nullish(),
  orderReference: z.string().trim().min(1).nullish(),
  intro: z.string().nullish(),
  closing: z.string().nullish(),
  paymentTermsText: z.string().nullish(),
  eInvoiceFormat: z.enum(["zugferd", "xrechnung", "keine"]).optional(),
  /** Nur Schlussrechnung: bereits berechnete Abschläge (brutto); leer = automatisch */
  prepaidCents: z.number().int().min(0).nullish(),
};

export const DraftCreate = z
  .object({
    type: z.enum(DRAFT_TYPES),
    contactId: z.uuid(),
    ...draftFields,
    lines: z.array(LineInput).min(1).max(500),
  })
  .openapi("BillingDraftCreate");

export const DraftPatch = z
  .object({
    contactId: z.uuid().optional(),
    ...draftFields,
    lines: z.array(LineInput).min(1).max(500).optional(),
  })
  .openapi("BillingDraftPatch");

// ---------------------------------------------------------------------------
// Entwürfe
// ---------------------------------------------------------------------------

async function resolveLines(tx: DbOrTx, input: z.infer<typeof LineInput>[], company: Company) {
  const codes = input.map((l) => l.articleCode).filter((c): c is string => Boolean(c));
  const known =
    codes.length > 0 ? await tx.select().from(articles).where(inArray(articles.code, codes)) : [];
  const byCode = new Map(known.map((a) => [a.code, a]));
  return input.map((l, i): Line => {
    const art = l.articleCode ? byCode.get(l.articleCode) : undefined;
    if (l.articleCode && !art) throw new DomainError(422, `Artikel ${l.articleCode} unbekannt`);
    const name = l.name ?? art?.name;
    if (!name) throw new DomainError(422, `Position ${i + 1}: Bezeichnung fehlt`);
    const unitPriceCents = l.unitPriceCents ?? art?.unitPriceCents;
    if (unitPriceCents === undefined) throw new DomainError(422, `Position ${i + 1}: Preis fehlt`);
    let taxCategory: TaxCategory =
      l.taxCategory ?? (art?.taxCategory as TaxCategory | undefined) ?? "S";
    let taxRatePercent = l.taxRatePercent ?? (art ? Number(art.taxRatePercent) : 19);
    // Kleinunternehmer: steuerpflichtige Positionen werden steuerfrei nach § 19 UStG
    if (company.smallBusiness && taxCategory === "S") {
      taxCategory = "E";
      taxRatePercent = 0;
    }
    if (taxCategory !== "S") taxRatePercent = 0;
    return {
      position: i + 1,
      articleCode: l.articleCode ?? null,
      name,
      description: l.description ?? art?.description ?? null,
      quantity: l.quantity,
      unitCode: l.unitCode ?? art?.unitCode ?? "C62",
      unitPriceCents,
      taxCategory,
      taxRatePercent,
    };
  });
}

function exemptionReasons(
  company: Company,
  lines: Line[],
  extra: Partial<Record<TaxCategory, string>> = {},
) {
  const reasons: Partial<Record<TaxCategory, string>> = { ...extra };
  const cats = new Set(lines.map((l) => l.taxCategory));
  if (company.smallBusiness && cats.has("E")) reasons.E = SMALL_BUSINESS_NOTE;
  if (cats.has("AE"))
    reasons.AE ??= "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).";
  return reasons;
}

async function saveLines(tx: DbOrTx, docId: string, lines: Line[], company: Company) {
  await tx.delete(billingLines).where(eq(billingLines.billingDocumentId, docId));
  const totals = computeTotals({
    lines,
    prepaidCents: 0,
    exemptionReasons: exemptionReasons(company, lines),
  });
  await tx.insert(billingLines).values(
    lines.map((l, i) => ({
      billingDocumentId: docId,
      position: l.position,
      articleCode: l.articleCode,
      name: l.name,
      description: l.description,
      quantity: String(l.quantity),
      unitCode: l.unitCode,
      unitPriceCents: l.unitPriceCents,
      taxCategory: l.taxCategory,
      taxRatePercent: String(l.taxRatePercent),
      lineNetCents: totals.lineNets[i] ?? 0,
    })),
  );
  return totals;
}

async function defaultFormat(tx: DbOrTx, contactId: string): Promise<"zugferd" | "xrechnung"> {
  const [c] = await tx
    .select({ leitwegId: contacts.leitwegId })
    .from(contacts)
    .where(eq(contacts.id, contactId));
  if (!c) throw new DomainError(422, "Kontakt nicht gefunden");
  return c.leitwegId ? "xrechnung" : "zugferd";
}

function nullable<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, v === undefined ? undefined : (v ?? null)]),
  );
}

export async function createDraft(tx: DbOrTx, input: z.infer<typeof DraftCreate>, actor: string) {
  const company = await getSetting(tx, "company");
  const lines = await resolveLines(tx, input.lines, company);
  const { lines: _l, ...fields } = input;
  const [doc] = await tx
    .insert(billingDocuments)
    .values({
      ...(nullable(fields) as Partial<typeof billingDocuments.$inferInsert>),
      type: input.type,
      contactId: input.contactId,
      status: "entwurf",
      source: "nativ",
      netCents: 0,
      taxCents: 0,
      grossCents: 0,
      prepaidCents: input.prepaidCents ?? 0,
      eInvoiceFormat: input.eInvoiceFormat ?? (await defaultFormat(tx, input.contactId)),
    })
    .returning({ id: billingDocuments.id });
  if (!doc) throw new Error("Beleg konnte nicht angelegt werden");
  const totals = await saveLines(tx, doc.id, lines, company);
  await tx
    .update(billingDocuments)
    .set({
      netCents: totals.lineTotalCents,
      taxCents: totals.taxCents,
      grossCents: totals.grandTotalCents,
    })
    .where(eq(billingDocuments.id, doc.id));
  await recordEvents(tx, [
    {
      entityType: "billing_document",
      entityId: doc.id,
      type: "billing_document.created",
      actor,
      payload: { type: input.type, grossCents: totals.grandTotalCents },
    },
  ]);
  return doc.id;
}

async function lockDraft(tx: DbOrTx, id: string): Promise<Doc> {
  const [row] = await tx.execute<{ id: string }>(
    sql`SELECT id FROM billing_documents WHERE id = ${id} FOR UPDATE`,
  );
  if (!row) throw new DomainError(404, "Beleg nicht gefunden");
  const [doc] = await tx.select().from(billingDocuments).where(eq(billingDocuments.id, id));
  if (!doc) throw new DomainError(404, "Beleg nicht gefunden");
  if (doc.source !== "nativ" || doc.status !== "entwurf") {
    throw new DomainError(409, "Nur Entwürfe können geändert werden");
  }
  return doc;
}

export async function updateDraft(
  tx: DbOrTx,
  id: string,
  patch: z.infer<typeof DraftPatch>,
  actor: string,
) {
  await lockDraft(tx, id);
  const company = await getSetting(tx, "company");
  const { lines: lineInput, ...fields } = patch;
  const set = nullable(fields) as Partial<typeof billingDocuments.$inferInsert>;
  if (patch.prepaidCents === null) set.prepaidCents = 0;
  if (Object.values(set).some((v) => v !== undefined)) {
    await tx.update(billingDocuments).set(set).where(eq(billingDocuments.id, id));
  }
  if (lineInput) {
    const totals = await saveLines(tx, id, await resolveLines(tx, lineInput, company), company);
    await tx
      .update(billingDocuments)
      .set({
        netCents: totals.lineTotalCents,
        taxCents: totals.taxCents,
        grossCents: totals.grandTotalCents,
      })
      .where(eq(billingDocuments.id, id));
  }
  await recordEvents(tx, [
    {
      entityType: "billing_document",
      entityId: id,
      type: "billing_document.updated",
      actor,
      payload: {},
    },
  ]);
}

export async function deleteDraft(tx: DbOrTx, id: string, actor: string) {
  await lockDraft(tx, id);
  await tx.delete(billingDocuments).where(eq(billingDocuments.id, id));
  await recordEvents(tx, [
    {
      entityType: "billing_document",
      entityId: id,
      type: "billing_document.draft_deleted",
      actor,
      payload: {},
    },
  ]);
}

// ---------------------------------------------------------------------------
// Festschreiben
// ---------------------------------------------------------------------------

function formatNumber(pattern: string, issueDate: string, padded: string) {
  return pattern
    .replace("{YYYY}", issueDate.slice(0, 4))
    .replace("{YY}", issueDate.slice(2, 4))
    .replace("{N}", padded);
}

function sequenceKeyFor(type: DocType): keyof Company["numberPatterns"] {
  if (type === "angebot" || type === "auftragsbestaetigung" || type === "zahlungserinnerung")
    return type;
  // Alle rechnungsartigen Belege teilen einen lückenlosen Nummernkreis
  return "rechnung";
}

function sellerParty(company: Company): Party {
  return {
    id: company.sellerId ?? (company.vatId ? null : (company.taxNumber ?? null)),
    name: company.name,
    street: company.street || null,
    postalCode: company.postalCode || null,
    city: company.city || null,
    country: company.country,
    vatId: company.vatId ?? null,
    taxNumber: company.taxNumber ?? null,
    email: company.email || null,
    contactName: company.contactName || null,
    phone: company.phone || null,
  };
}

async function buyerParty(
  tx: DbOrTx,
  contactId: string,
): Promise<Party & { leitwegId: string | null }> {
  const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) throw new DomainError(422, "Kontakt nicht gefunden");
  const emails = await tx
    .select()
    .from(contactChannels)
    .where(and(eq(contactChannels.contactId, contactId), eq(contactChannels.kind, "email")))
    .orderBy(asc(contactChannels.createdAt));
  const email = (emails.find((e) => e.isPrimary) ?? emails[0])?.value ?? null;
  return {
    id: c.customerNumber,
    name: c.kind === "organisation" ? (c.organisationName ?? c.displayName) : c.displayName,
    street: c.street,
    postalCode: c.postalCode,
    city: c.city,
    country: c.country,
    vatId: c.vatId,
    taxNumber: null,
    email,
    contactName: null,
    phone: null,
    leitwegId: c.leitwegId,
  };
}

async function loadLines(tx: DbOrTx, docId: string): Promise<Line[]> {
  const rows = await tx
    .select()
    .from(billingLines)
    .where(eq(billingLines.billingDocumentId, docId))
    .orderBy(asc(billingLines.position));
  return rows.map((r) => ({
    position: r.position,
    articleCode: r.articleCode,
    name: r.name,
    description: r.description,
    quantity: Number(r.quantity),
    unitCode: r.unitCode,
    unitPriceCents: r.unitPriceCents,
    taxCategory: r.taxCategory,
    taxRatePercent: Number(r.taxRatePercent),
  }));
}

/** Summe der festgeschriebenen, nicht stornierten Abschlagsrechnungen eines Vorgangs. */
async function priorPartialInvoices(tx: DbOrTx, caseId: string | null, excludeId: string) {
  if (!caseId) return [];
  const rows = await tx
    .select()
    .from(billingDocuments)
    .where(
      and(
        eq(billingDocuments.caseId, caseId),
        eq(billingDocuments.type, "abschlagsrechnung"),
        inArray(billingDocuments.status, ["festgeschrieben", "versendet"]),
      ),
    );
  return rows.filter((r) => r.id !== excludeId);
}

async function storeFile(
  tx: DbOrTx,
  services: Services,
  doc: Doc,
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
  docClass: string,
) {
  const [kase] = doc.caseId ? await tx.select().from(cases).where(eq(cases.id, doc.caseId)) : [];
  const year = (doc.issueDate ?? todayIso()).slice(0, 4);
  const folder = kase?.storagePath
    ? `${kase.storagePath.replace(/\/$/, "")}/Belege`
    : `${services.storageBasePath.replace(/\/$/, "")}/belege/${year}`;
  const stored = await services.storage.put(`${folder}/${filename}`, bytes, mimeType);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const [row] = await tx
    .insert(documents)
    .values({
      caseId: doc.caseId,
      contactId: doc.contactId,
      title: filename,
      docClass,
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
  if (!row) throw new Error("Datei konnte nicht registriert werden");
  return { id: row.id, sha256 };
}

function metaRows(
  doc: Doc,
  buyer: Party & { leitwegId: string | null },
  caseNumber: string | null,
  preceding: Doc | null,
) {
  const rows: [string, string][] = [];
  const de = (iso: string) => iso.split("-").reverse().join(".");
  if (buyer.id) rows.push(["Kundennr.", buyer.id]);
  if (caseNumber) rows.push(["Vorgang", caseNumber]);
  if (doc.servicePeriodStart && doc.servicePeriodEnd) {
    rows.push(["Leistungszeitraum", `${de(doc.servicePeriodStart)} – ${de(doc.servicePeriodEnd)}`]);
  } else if (doc.serviceDate) rows.push(["Leistungsdatum", de(doc.serviceDate)]);
  if (doc.dueDate && doc.type !== "angebot") rows.push(["Fällig am", de(doc.dueDate)]);
  if (doc.buyerReference)
    rows.push([
      buyer.leitwegId === doc.buyerReference ? "Leitweg-ID" : "Ihre Referenz",
      doc.buyerReference,
    ]);
  if (doc.orderReference) rows.push(["Bestellnr.", doc.orderReference]);
  if (preceding?.number) rows.push([`Bezug`, `${TITLES[preceding.type]} ${preceding.number}`]);
  return rows;
}

/**
 * Bereitet einen Beleg vollständig auf (Summen, E-Rechnung, PDF), ohne etwas zu speichern.
 * Wird von Vorschau (Nummer „ENTWURF“) und Festschreiben gemeinsam genutzt.
 */
async function prepareDocument(
  tx: DbOrTx,
  doc: Doc,
  company: Company,
  now: Date,
  number: string,
  draft = false,
) {
  if (!company.name || !company.city)
    throw new DomainError(422, "Firmendaten unvollständig (Einstellungen „company“)");
  const buyer = await buyerParty(tx, doc.contactId);
  const lines = await loadLines(tx, doc.id);
  const issueDate = doc.issueDate ?? todayIso(now);
  const invoiceLike = isInvoiceKind(doc.type);
  const dueDate = doc.dueDate ?? (invoiceLike ? addDays(issueDate, company.paymentDays) : null);
  const [preceding] = doc.precedingDocumentId
    ? await tx
        .select()
        .from(billingDocuments)
        .where(eq(billingDocuments.id, doc.precedingDocumentId))
    : [];

  // Schlussrechnung: bereits berechnete Abschläge abziehen
  const notes: string[] = [];
  let prepaid = doc.prepaidCents;
  if (doc.type === "schlussrechnung") {
    const partials = await priorPartialInvoices(tx, doc.caseId, doc.id);
    if (prepaid === 0) prepaid = partials.reduce((s, p) => s + p.grossCents, 0);
    if (partials.length > 0) {
      notes.push(
        `Abzüglich bereits berechneter Abschlagsrechnungen: ${partials.map((p) => p.number).join(", ")}.`,
      );
    }
  }

  const reasons = exemptionReasons(company, lines);
  const termsText =
    doc.paymentTermsText ??
    (invoiceLike && dueDate
      ? `Zahlbar ohne Abzug bis ${dueDate.split("-").reverse().join(".")}.`
      : null);
  const buyerReference = doc.buyerReference ?? buyer.leitwegId;
  const canonical: CanonicalInvoice = {
    kind: invoiceLike ? (doc.type as InvoiceKind) : "rechnung",
    number,
    issueDate,
    dueDate,
    currency: doc.currency,
    buyerReference,
    orderReference: doc.orderReference,
    precedingInvoice: preceding?.number
      ? { number: preceding.number, issueDate: preceding.issueDate }
      : null,
    serviceDate:
      doc.serviceDate ?? (doc.servicePeriodStart ? null : invoiceLike ? issueDate : null),
    servicePeriod:
      doc.servicePeriodStart && doc.servicePeriodEnd
        ? { start: doc.servicePeriodStart, end: doc.servicePeriodEnd }
        : null,
    seller: sellerParty(company),
    buyer,
    payment: {
      iban: company.iban ?? null,
      bic: company.bic ?? null,
      accountName: company.name,
      termsText,
      reference: number,
    },
    notes: [doc.intro, ...notes].filter((n): n is string => Boolean(n)),
    exemptionReasons: reasons,
    lines,
    prepaidCents: prepaid,
  };
  const totals = computeTotals(canonical);

  const format = invoiceLike ? doc.eInvoiceFormat : "keine";
  const profile: CiiProfile | null =
    format === "xrechnung" ? "xrechnung" : format === "zugferd" ? "en16931" : null;
  const violations = profile ? checkInvoice(canonical, profile) : [];
  if (violations.length > 0 && !draft) {
    throw new DomainError(
      422,
      `E-Rechnung unvollständig: ${violations.map((v) => `${v.message} [${v.rule}]`).join("; ")}`,
    );
  }
  const xml = profile ? buildCii(canonical, profile) : null;

  const view: DocumentView = {
    title: draft ? `${TITLES[doc.type]} (Entwurf)` : TITLES[doc.type],
    number,
    issueDate,
    seller: {
      ...sellerParty(company),
      iban: company.iban ?? null,
      bic: company.bic ?? null,
      bankName: company.bankName ?? null,
      website: company.website ?? null,
    },
    buyer,
    meta: metaRows(
      { ...doc, dueDate, buyerReference },
      buyer,
      await caseNumber(tx, doc.caseId),
      preceding ?? null,
    ),
    intro: [
      buyer.contactName ? `Guten Tag ${buyer.contactName},` : "Sehr geehrte Damen und Herren,",
      doc.intro ?? defaultIntro(company, doc.type),
    ]
      .filter(Boolean)
      .join("\n"),
    lines,
    prepaidCents: prepaid,
    exemptionReasons: reasons,
    closing: [
      ...notes,
      ...(doc.type === "stornorechnung" && preceding?.number
        ? [`Diese Stornorechnung hebt die Rechnung ${preceding.number} vollständig auf.`]
        : []),
      termsText ?? "",
      doc.closing ?? defaultClosing(company, doc.type),
    ].filter(Boolean),
    summary:
      doc.type === "angebot" || doc.type === "auftragsbestaetigung"
        ? "offer"
        : doc.type === "zahlungserinnerung"
          ? "reminder"
          : "invoice",
    attachment:
      profile === "en16931" && xml && !draft
        ? { xml, conformanceLevel: "EN 16931", documentType: "INVOICE" }
        : undefined,
    createdAt: now,
  };
  const pdf = await renderDocumentPdf(view);
  return {
    canonical,
    totals,
    profile,
    xml,
    pdf,
    format,
    issueDate,
    dueDate,
    buyer,
    buyerReference,
    termsText,
    prepaid,
    preceding: preceding ?? null,
    violations,
  };
}

/** Vorschau eines Entwurfs als PDF inkl. Hinweisen der Vorprüfung – ohne Nummer, ohne Speicherung. */
export async function previewDocument(db: Database, id: string) {
  const [doc] = await db.select().from(billingDocuments).where(eq(billingDocuments.id, id));
  if (!doc) throw new DomainError(404, "Beleg nicht gefunden");
  if (doc.status !== "entwurf")
    throw new DomainError(
      409,
      "Vorschau nur für Entwürfe; festgeschriebene Belege als PDF abrufen",
    );
  const company = await getSetting(db, "company");
  const prep = await prepareDocument(db, doc, company, new Date(), "ENTWURF", true);
  return { pdf: prep.pdf, violations: prep.violations, totals: prep.totals, xml: prep.xml };
}

export interface FinalizeResult {
  number: string;
  pdfDocumentId: string;
  xmlDocumentId: string | null;
  validation: {
    mode: string;
    valid: boolean;
    errors: string[];
    warnings: string[];
    validator: string | null;
  };
}

/**
 * Schreibt einen Entwurf fest: Nummer vergeben, E-Rechnung erzeugen und prüfen, PDF/A-3 erzeugen,
 * Dateien ablegen, Inhalts-Hash speichern. Schlägt eine Prüfung fehl, wird alles zurückgerollt –
 * auch die Nummer, sodass der Nummernkreis lückenlos bleibt.
 */
export async function finalizeDocument(
  db: Database,
  services: Services,
  id: string,
  actor: string,
  opts: { now?: Date } = {},
): Promise<FinalizeResult> {
  const now = opts.now ?? new Date();
  const result = await db.transaction(async (tx) => {
    let doc = await lockDraft(tx, id);
    const company = await getSetting(tx, "company");
    const seq = await nextNumber(tx, `beleg:${sequenceKeyFor(doc.type)}`);
    const issueDateForNumber = doc.issueDate ?? todayIso(now);
    const number = formatNumber(
      company.numberPatterns[sequenceKeyFor(doc.type)],
      issueDateForNumber,
      seq.padded,
    );
    const prep = await prepareDocument(tx, doc, company, now, number);
    const {
      canonical,
      totals,
      profile,
      xml,
      pdf,
      format,
      issueDate,
      dueDate,
      buyer,
      buyerReference,
      termsText,
      prepaid,
      preceding,
    } = prep;
    const validation: FinalizeResult["validation"] = {
      mode: services.eInvoiceValidation,
      valid: true,
      errors: [],
      warnings: [],
      validator: null,
    };
    if (profile) {
      if (services.validator) {
        // ZUGFeRD: das komplette PDF prüfen (PDF/A-3 + XML), XRechnung: die XML-Datei
        const r = await services.validator.validate(
          profile === "en16931" ? pdf : new TextEncoder().encode(xml ?? ""),
        );
        Object.assign(validation, r, { validator: r.validator });
        if (!r.valid) {
          throw new DomainError(422, `E-Rechnung ungültig: ${r.errors.slice(0, 5).join(" | ")}`);
        }
      } else if (services.eInvoiceValidation === "required") {
        throw new DomainError(
          422,
          "Kein E-Rechnungs-Validator konfiguriert (EINVOICE_VALIDATOR_URL)",
        );
      } else {
        validation.warnings.push("Nur interne Vorprüfung – kein externer Validator konfiguriert");
      }
    }

    doc = { ...doc, issueDate };
    const pdfFile = await storeFile(
      tx,
      services,
      doc,
      `${number}.pdf`,
      pdf,
      "application/pdf",
      TITLES[doc.type].toLowerCase(),
    );
    const xmlFile =
      profile === "xrechnung" && xml
        ? await storeFile(
            tx,
            services,
            doc,
            `${number}.xml`,
            new TextEncoder().encode(xml),
            "application/xml",
            "xrechnung",
          )
        : null;
    const xmlSha = xml ? createHash("sha256").update(xml).digest("hex") : null;
    const contentHash = createHash("sha256")
      .update(JSON.stringify({ canonical, pdf: pdfFile.sha256, xml: xmlSha }))
      .digest("hex");

    await tx
      .update(billingDocuments)
      .set({
        number,
        issueDate,
        dueDate,
        buyerReference,
        paymentTermsText: termsText,
        prepaidCents: prepaid,
        netCents: totals.lineTotalCents,
        taxCents: totals.taxCents,
        grossCents: totals.grandTotalCents,
        status: "festgeschrieben",
        finalizedAt: now,
        contentHash,
        sellerSnapshot: canonical.seller,
        buyerSnapshot: buyer,
        pdfDocumentId: pdfFile.id,
        xmlDocumentId: xmlFile?.id ?? null,
        validation,
      })
      .where(eq(billingDocuments.id, id));
    if (doc.type === "stornorechnung" && preceding) {
      await tx
        .update(billingDocuments)
        .set({ status: "storniert" })
        .where(eq(billingDocuments.id, preceding.id));
    }
    await recordEvents(tx, [
      {
        entityType: "billing_document",
        entityId: id,
        type: "billing_document.finalized",
        actor,
        payload: {
          number,
          type: doc.type,
          grossCents: totals.grandTotalCents,
          contentHash,
          format,
        },
      },
    ]);
    if (doc.caseId) await recomputeCaseStatus(tx, doc.caseId, actor);
    return { number, pdfDocumentId: pdfFile.id, xmlDocumentId: xmlFile?.id ?? null, validation };
  });
  return result;
}

async function caseNumber(tx: DbOrTx, caseId: string | null) {
  if (!caseId) return null;
  const [c] = await tx.select({ number: cases.number }).from(cases).where(eq(cases.id, caseId));
  return c?.number ?? null;
}

function defaultIntro(company: Company, type: DocType) {
  if (type === "angebot") return company.texts.offerIntro;
  if (type === "stornorechnung") return "hiermit stornieren wir die unten genannte Rechnung.";
  return company.texts.invoiceIntro;
}

function defaultClosing(company: Company, type: DocType) {
  if (type === "angebot") return company.texts.offerClosing;
  if (type === "stornorechnung") return "";
  return company.texts.invoiceClosing;
}

// ---------------------------------------------------------------------------
// Folgebelege
// ---------------------------------------------------------------------------

/** Storniert eine festgeschriebene Rechnung durch eine Stornorechnung (Kopie der Positionen). */
export async function cancelInvoice(db: Database, services: Services, id: string, actor: string) {
  const stornoId = await db.transaction(async (tx) => {
    const [orig] = await tx.select().from(billingDocuments).where(eq(billingDocuments.id, id));
    if (!orig) throw new DomainError(404, "Beleg nicht gefunden");
    if (orig.source !== "nativ" || !isInvoiceKind(orig.type) || orig.type === "stornorechnung") {
      throw new DomainError(422, "Nur eigene Rechnungen können storniert werden");
    }
    if (!["festgeschrieben", "versendet"].includes(orig.status)) {
      throw new DomainError(409, "Rechnung ist nicht (mehr) stornierbar");
    }
    const lines = await loadLines(tx, id);
    const [storno] = await tx
      .insert(billingDocuments)
      .values({
        type: "stornorechnung",
        contactId: orig.contactId,
        caseId: orig.caseId,
        status: "entwurf",
        source: "nativ",
        netCents: 0,
        taxCents: 0,
        grossCents: 0,
        precedingDocumentId: orig.id,
        buyerReference: orig.buyerReference,
        orderReference: orig.orderReference,
        serviceDate: orig.serviceDate,
        servicePeriodStart: orig.servicePeriodStart,
        servicePeriodEnd: orig.servicePeriodEnd,
        eInvoiceFormat: orig.eInvoiceFormat,
        paymentTermsText: "Der Betrag wird verrechnet bzw. erstattet.",
      })
      .returning({ id: billingDocuments.id });
    if (!storno) throw new Error("Storno konnte nicht angelegt werden");
    const company = await getSetting(tx, "company");
    const totals = await saveLines(tx, storno.id, lines, company);
    await tx
      .update(billingDocuments)
      .set({
        netCents: totals.lineTotalCents,
        taxCents: totals.taxCents,
        grossCents: totals.grandTotalCents,
      })
      .where(eq(billingDocuments.id, storno.id));
    return storno.id;
  });
  try {
    const r = await finalizeDocument(db, services, stornoId, actor);
    await db.transaction((tx) =>
      recordEvents(tx, [
        {
          entityType: "billing_document",
          entityId: id,
          type: "billing_document.cancelled",
          actor,
          payload: { storno: r.number },
        },
      ]),
    );
    return { stornoId, ...r };
  } catch (err) {
    // Entwurf des Stornos wieder entfernen, wenn das Festschreiben scheitert
    await db.transaction((tx) => deleteDraft(tx, stornoId, actor)).catch(() => undefined);
    throw err;
  }
}

/** Übernimmt ein Angebot/eine Auftragsbestätigung als neuen Entwurf eines anderen Typs. */
export async function convertDocument(
  tx: DbOrTx,
  id: string,
  type: (typeof DRAFT_TYPES)[number],
  actor: string,
) {
  const [src] = await tx.select().from(billingDocuments).where(eq(billingDocuments.id, id));
  if (!src) throw new DomainError(404, "Beleg nicht gefunden");
  const lines = await loadLines(tx, id);
  const newId = await createDraft(
    tx,
    {
      type,
      contactId: src.contactId,
      caseId: src.caseId,
      buyerReference: src.buyerReference,
      orderReference: src.orderReference,
      serviceDate: src.serviceDate,
      servicePeriodStart: src.servicePeriodStart,
      servicePeriodEnd: src.servicePeriodEnd,
      lines: lines.map((l) => ({
        articleCode: null,
        name: l.name,
        description: l.description,
        quantity: l.quantity,
        unitCode: l.unitCode,
        unitPriceCents: l.unitPriceCents,
        taxCategory: l.taxCategory,
        taxRatePercent: l.taxRatePercent,
      })),
    },
    actor,
  );
  await tx
    .update(billingDocuments)
    .set({ precedingDocumentId: src.id })
    .where(eq(billingDocuments.id, newId));
  return newId;
}

/** Erstellt eine Zahlungserinnerung/Mahnung zu einer offenen Rechnung (PDF, festgeschrieben). */
export async function createReminder(
  db: Database,
  services: Services,
  invoiceId: string,
  input: { level: number; feeCents: number; openCents: number; dueDays: number },
  actor: string,
) {
  const company = await getSetting(db, "company");
  const [inv] = await db.select().from(billingDocuments).where(eq(billingDocuments.id, invoiceId));
  if (!inv || !isInvoiceKind(inv.type)) throw new DomainError(404, "Rechnung nicht gefunden");
  const de = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");
  const lines: z.infer<typeof LineInput>[] = [
    {
      name: `Offener Betrag aus ${TITLES[inv.type]} ${inv.number} vom ${de(inv.issueDate)}`,
      quantity: 1,
      unitCode: "E48",
      unitPriceCents: input.openCents,
      taxCategory: "O",
    },
  ];
  if (input.feeCents > 0) {
    lines.push({
      name: "Mahngebühr",
      quantity: 1,
      unitCode: "E48",
      unitPriceCents: input.feeCents,
      taxCategory: "O",
    });
  }
  const id = await db.transaction(async (tx) => {
    const draftId = await createDraft(
      tx,
      {
        type: "rechnung",
        contactId: inv.contactId,
        caseId: inv.caseId,
        dueDate: addDays(todayIso(), input.dueDays),
        intro:
          company.texts.reminder[Math.min(input.level, company.texts.reminder.length) - 1] ?? null,
        closing:
          "Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.",
        eInvoiceFormat: "keine",
        lines,
      },
      actor,
    );
    // Typ und Bezug direkt setzen (Mahnungen sind keine Rechnungen, daher kein Rechnungs-Entwurfstyp)
    await tx
      .update(billingDocuments)
      .set({
        type: "zahlungserinnerung",
        precedingDocumentId: inv.id,
        reminderLevel: input.level,
        eInvoiceFormat: "keine",
      })
      .where(eq(billingDocuments.id, draftId));
    return draftId;
  });
  const r = await finalizeDocument(db, services, id, actor);
  return { id, ...r };
}

export async function markSent(tx: DbOrTx, id: string, via: string, actor: string) {
  const [doc] = await tx.select().from(billingDocuments).where(eq(billingDocuments.id, id));
  if (!doc) throw new DomainError(404, "Beleg nicht gefunden");
  if (doc.status !== "festgeschrieben")
    throw new DomainError(409, "Nur festgeschriebene Belege können als versendet markiert werden");
  await tx
    .update(billingDocuments)
    .set({ status: "versendet", sentAt: new Date(), sentVia: via })
    .where(eq(billingDocuments.id, id));
  await recordEvents(tx, [
    {
      entityType: "billing_document",
      entityId: id,
      type: "billing_document.sent",
      actor,
      payload: { via, number: doc.number },
    },
  ]);
  if (doc.caseId) await recomputeCaseStatus(tx, doc.caseId, actor);
}

export { loadLines };
