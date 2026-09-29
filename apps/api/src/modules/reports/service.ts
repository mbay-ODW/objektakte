import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import type { Services } from "../../adapters/index.js";
import type { DbOrTx } from "../../db/client.js";
import {
  bankTransactions,
  billingDocuments,
  billingLines,
  contacts,
  documents,
  paymentAllocations,
} from "../../db/schema.js";
import { encodeCp1252 } from "../../lib/cp1252.js";
import { DomainError } from "../../lib/errors.js";
import { getSetting } from "../../lib/settings.js";
import { roundCents } from "../billing/model.js";
import { loadReceivables, RECEIVABLE_TYPES } from "../payments/service.js";
import { buildDatevCsv, type DatevBooking } from "./datev.js";

export interface RevenueRow {
  period: string;
  netCents: number;
  taxCents: number;
  grossCents: number;
  count: number;
}

const month = (d: string) => d.slice(0, 7);

function add(
  map: Map<string, RevenueRow>,
  period: string,
  net: number,
  tax: number,
  gross: number,
) {
  const row = map.get(period) ?? { period, netCents: 0, taxCents: 0, grossCents: 0, count: 0 };
  row.netCents += net;
  row.taxCents += tax;
  row.grossCents += gross;
  row.count += 1;
  map.set(period, row);
}

/** Aufteilung eines Zahlbetrags auf Netto/Steuer im Verhältnis des Belegs. */
export function splitGross(paidCents: number, netCents: number, grossCents: number) {
  if (grossCents === 0) return { net: paidCents, tax: 0 };
  const net = Math.round((paidCents * netCents) / grossCents);
  return { net, tax: paidCents - net };
}

/** Belegarten mit Umsatzwirkung und ihr Vorzeichen. */
const REVENUE_TYPES = [...RECEIVABLE_TYPES, "stornorechnung", "gutschrift"] as const;
const signOf = (type: string) => (type === "stornorechnung" || type === "gutschrift" ? -1 : 1);
type Doc = typeof billingDocuments.$inferSelect;

/**
 * Umsatz je Monat.
 * - soll: nach Rechnungsdatum; stornierte Rechnungen zählen im Monat ihrer Ausstellung,
 *   Stornorechnungen und Gutschriften mindern im Monat ihrer Ausstellung. Schlussrechnungen
 *   zählen nur mit dem Betrag nach Abzug der bereits berechneten Abschläge.
 * - ist: nach Zahlungseingang (zugeordnete Bankumsätze), Netto/Steuer anteilig.
 */
export async function revenueReport(db: DbOrTx, from: string, to: string, basis: "soll" | "ist") {
  const map = new Map<string, RevenueRow>();
  if (basis === "soll") {
    const docs = await db
      .select()
      .from(billingDocuments)
      .where(
        and(
          inArray(billingDocuments.type, [...REVENUE_TYPES]),
          inArray(billingDocuments.status, ["festgeschrieben", "versendet", "storniert"]),
          gte(billingDocuments.issueDate, from),
          lte(billingDocuments.issueDate, to),
        ),
      );
    for (const d of docs) {
      if (!d.issueDate) continue;
      const sign = signOf(d.type);
      add(
        map,
        month(d.issueDate),
        sign * (d.netCents - d.prepaidNetCents),
        sign * (d.taxCents - d.prepaidTaxCents),
        sign * (d.grossCents - d.prepaidCents),
      );
    }
  } else {
    const rows = await db
      .select({
        amount: paymentAllocations.amountCents,
        bookingDate: bankTransactions.bookingDate,
        doc: billingDocuments,
      })
      .from(paymentAllocations)
      .innerJoin(bankTransactions, eq(bankTransactions.id, paymentAllocations.transactionId))
      .innerJoin(billingDocuments, eq(billingDocuments.id, paymentAllocations.billingDocumentId))
      .where(and(gte(bankTransactions.bookingDate, from), lte(bankTransactions.bookingDate, to)));
    for (const r of rows) {
      const { net, tax } = splitGross(
        r.amount,
        r.doc.netCents - r.doc.prepaidNetCents,
        r.doc.grossCents - r.doc.prepaidCents,
      );
      add(map, month(r.bookingDate), net, tax, r.amount);
    }
  }
  const periods = [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
  const total = periods.reduce(
    (t, r) => ({
      netCents: t.netCents + r.netCents,
      taxCents: t.taxCents + r.taxCents,
      grossCents: t.grossCents + r.grossCents,
      count: t.count + r.count,
    }),
    { netCents: 0, taxCents: 0, grossCents: 0, count: 0 },
  );
  return { basis, from, to, periods, total };
}

type DatevSettings = Awaited<ReturnType<typeof getSetting<"datev">>>;

export interface TaxGroup {
  category: string;
  ratePercent: number;
  grossCents: number;
}

/** Erlöskonto je Steuerkategorie und -satz (Automatikkonten). */
export function revenueAccount(
  settings: DatevSettings,
  g: Pick<TaxGroup, "category" | "ratePercent">,
) {
  if (g.category === "S") {
    return g.ratePercent >= 19
      ? settings.revenueAccounts.standard
      : settings.revenueAccounts.reduced;
  }
  if (g.category === "AE") return settings.revenueAccounts.reverseCharge;
  return settings.revenueAccounts.exempt;
}

/** Bruttobeträge eines Belegs je Steuerkategorie/-satz (aus Positionen; Import: aus Kopfbeträgen). */
async function taxGroups(db: DbOrTx, doc: Doc): Promise<TaxGroup[]> {
  const lines = await db
    .select()
    .from(billingLines)
    .where(eq(billingLines.billingDocumentId, doc.id));
  if (lines.length === 0) {
    const rate = doc.netCents === 0 ? 0 : Math.round((doc.taxCents / doc.netCents) * 100);
    return [
      { category: doc.taxCents === 0 ? "E" : "S", ratePercent: rate, grossCents: doc.grossCents },
    ];
  }
  const groups = new Map<string, { category: string; ratePercent: number; net: number }>();
  for (const l of lines) {
    const rate = Number(l.taxRatePercent);
    const key = `${l.taxCategory}|${rate}`;
    const g = groups.get(key) ?? { category: l.taxCategory, ratePercent: rate, net: 0 };
    g.net += l.lineNetCents;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    category: g.category,
    ratePercent: g.ratePercent,
    grossCents: g.net + roundCents((g.net * g.ratePercent) / 100),
  }));
}

/** Steuergruppen nach Abzug der in einer Schlussrechnung abgesetzten Abschläge. */
async function effectiveGroups(db: DbOrTx, doc: Doc): Promise<TaxGroup[]> {
  const groups = await taxGroups(db, doc);
  const deductions = (doc.deductions as { id: string | null; grossCents: number }[]) ?? [];
  for (const d of deductions) {
    const [partial] = d.id
      ? await db.select().from(billingDocuments).where(eq(billingDocuments.id, d.id))
      : [];
    const sub = partial ? await taxGroups(db, partial) : proportional(groups, d.grossCents);
    for (const s of sub) {
      const g = groups.find((x) => x.category === s.category && x.ratePercent === s.ratePercent);
      if (g) g.grossCents -= s.grossCents;
      else groups.push({ ...s, grossCents: -s.grossCents });
    }
  }
  return groups.filter((g) => g.grossCents !== 0);
}

/** Verteilt einen Betrag im Verhältnis der Gruppen (Rundungsrest auf die letzte Gruppe). */
export function proportional(groups: TaxGroup[], amountCents: number): TaxGroup[] {
  const total = groups.reduce((s, g) => s + g.grossCents, 0);
  if (groups.length === 0 || total === 0) {
    return [{ category: "S", ratePercent: 19, grossCents: amountCents }];
  }
  let rest = amountCents;
  return groups.map((g, i) => {
    const part = i === groups.length - 1 ? rest : Math.round((amountCents * g.grossCents) / total);
    rest -= part;
    return { ...g, grossCents: part };
  });
}

/** Beginn des Wirtschaftsjahres, in dem `date` liegt (Einstellung „MM-TT“). */
export function fiscalYearStart(date: string, mmdd: string): string {
  const candidate = `${date.slice(0, 4)}-${mmdd}`;
  return candidate <= date ? candidate : `${Number(date.slice(0, 4)) - 1}-${mmdd}`;
}

export async function datevExport(db: DbOrTx, from: string, to: string, now = new Date()) {
  const settings = await getSetting(db, "datev");
  if (!settings.consultantNumber || !settings.clientNumber) {
    throw new DomainError(422, "DATEV-Einstellungen unvollständig (Berater- und Mandantennummer)");
  }
  const fyStart = fiscalYearStart(from, settings.fiscalYearStart);
  const nextFyStart = `${Number(fyStart.slice(0, 4)) + 1}${fyStart.slice(4)}`;
  if (to >= nextFyStart) {
    throw new DomainError(
      422,
      "Der Zeitraum eines Buchungsstapels darf nur ein Wirtschaftsjahr umfassen",
    );
  }
  const bookings: DatevBooking[] = [];
  const payments = await db
    .select({
      amount: paymentAllocations.amountCents,
      bookingDate: bankTransactions.bookingDate,
      doc: billingDocuments,
      contact: contacts.displayName,
    })
    .from(paymentAllocations)
    .innerJoin(bankTransactions, eq(bankTransactions.id, paymentAllocations.transactionId))
    .innerJoin(billingDocuments, eq(billingDocuments.id, paymentAllocations.billingDocumentId))
    .innerJoin(contacts, eq(contacts.id, billingDocuments.contactId))
    .where(and(gte(bankTransactions.bookingDate, from), lte(bankTransactions.bookingDate, to)));

  if (settings.mode === "ist") {
    // Zahlungseingang: Bank an Erlöse, aufgeteilt nach Steuersätzen des Belegs
    for (const p of payments) {
      for (const g of proportional(await effectiveGroups(db, p.doc), p.amount)) {
        if (g.grossCents === 0) continue;
        bookings.push({
          amountCents: Math.abs(g.grossCents),
          debitCredit: g.grossCents > 0 ? "S" : "H",
          account: settings.bankAccount,
          contraAccount: revenueAccount(settings, g),
          date: p.bookingDate,
          document1: p.doc.number ?? "",
          text: p.contact,
        });
      }
    }
  } else {
    const docs = await db
      .select({ doc: billingDocuments, contact: contacts.displayName })
      .from(billingDocuments)
      .innerJoin(contacts, eq(contacts.id, billingDocuments.contactId))
      .where(
        and(
          inArray(billingDocuments.type, [...REVENUE_TYPES]),
          inArray(billingDocuments.status, ["festgeschrieben", "versendet", "storniert"]),
          gte(billingDocuments.issueDate, from),
          lte(billingDocuments.issueDate, to),
        ),
      );
    // Rechnungsausgang: Debitor an Erlöse je Steuersatz; Storno/Gutschrift im Haben
    for (const { doc, contact } of docs) {
      if (!doc.issueDate) continue;
      for (const g of await effectiveGroups(db, doc)) {
        const amount = signOf(doc.type) * g.grossCents;
        bookings.push({
          amountCents: Math.abs(amount),
          debitCredit: amount > 0 ? "S" : "H",
          account: settings.debtorAccount,
          contraAccount: revenueAccount(settings, g),
          date: doc.issueDate,
          document1: doc.number ?? "",
          text: contact,
        });
      }
    }
    // Zahlungseingang: Bank an Debitor
    for (const p of payments) {
      bookings.push({
        amountCents: p.amount,
        debitCredit: "S",
        account: settings.bankAccount,
        contraAccount: settings.debtorAccount,
        date: p.bookingDate,
        document1: p.doc.number ?? "",
        text: p.contact,
      });
    }
  }
  bookings.sort((a, b) => a.date.localeCompare(b.date) || a.document1.localeCompare(b.document1));
  const csv = buildDatevCsv(
    {
      consultantNumber: settings.consultantNumber,
      clientNumber: settings.clientNumber,
      fiscalYearStart: fyStart.replace(/-/g, ""),
      accountLength: settings.accountLength,
      from,
      to,
      label: `objektakte ${from.slice(0, 7)}`,
      createdAt: now,
    },
    bookings,
  );
  return { csv, bytes: encodeCp1252(csv), bookings: bookings.length };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const euro = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/**
 * Monatspaket für die Steuerberatung: DATEV-Stapel (falls konfiguriert), Rechnungsausgangs-
 * liste, Zahlungseingänge, offene Posten und alle Rechnungs-PDFs aus der Ablage.
 */
export async function monthlyPackage(db: DbOrTx, services: Services, monthStr: string) {
  const from = `${monthStr}-01`;
  const [y, m] = monthStr.split("-").map(Number) as [number, number];
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const files: Record<string, Uint8Array> = {};
  const notes: string[] = [];

  try {
    files[`datev-buchungsstapel-${monthStr}.csv`] = (await datevExport(db, from, to)).bytes;
  } catch (err) {
    notes.push(`DATEV-Export übersprungen: ${err instanceof Error ? err.message : String(err)}`);
  }

  const docs = await db
    .select({ doc: billingDocuments, contact: contacts.displayName, pdf: documents })
    .from(billingDocuments)
    .innerJoin(contacts, eq(contacts.id, billingDocuments.contactId))
    .leftJoin(documents, eq(documents.id, billingDocuments.pdfDocumentId))
    .where(
      and(
        inArray(billingDocuments.type, [...RECEIVABLE_TYPES, "stornorechnung", "gutschrift"]),
        inArray(billingDocuments.status, ["festgeschrieben", "versendet", "storniert"]),
        gte(billingDocuments.issueDate, from),
        lte(billingDocuments.issueDate, to),
      ),
    );
  const outLines = [
    ["Belegnummer", "Art", "Datum", "Kunde", "Netto", "USt", "Brutto", "Status"].join(";"),
  ];
  for (const { doc, contact, pdf } of docs.sort((a, b) =>
    (a.doc.number ?? "").localeCompare(b.doc.number ?? ""),
  )) {
    outLines.push(
      [
        doc.number,
        doc.type,
        doc.issueDate,
        contact,
        euro(doc.netCents),
        euro(doc.taxCents),
        euro(doc.grossCents),
        doc.status,
      ]
        .map(csvCell)
        .join(";"),
    );
    if (!pdf) {
      notes.push(`Kein PDF zu ${doc.number ?? doc.id}`);
      continue;
    }
    try {
      if (pdf.storage !== services.storage.kind)
        throw new Error(`Ablage ${pdf.storage} nicht angebunden`);
      // Eindeutiger Name je Beleg (gleichnamige Dateien in verschiedenen Ordnern möglich)
      const ext = pdf.location.split(".").pop() ?? "pdf";
      files[`belege/${doc.number ?? doc.id}.${ext}`] = await services.storage.get(pdf.location);
    } catch (err) {
      notes.push(
        `PDF zu ${doc.number ?? doc.id} nicht abrufbar: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  files[`rechnungsausgang-${monthStr}.csv`] = encodeCp1252(`${outLines.join("\r\n")}\r\n`);

  const pays = await db
    .select({
      t: bankTransactions,
      number: billingDocuments.number,
      amount: paymentAllocations.amountCents,
    })
    .from(paymentAllocations)
    .innerJoin(bankTransactions, eq(bankTransactions.id, paymentAllocations.transactionId))
    .innerJoin(billingDocuments, eq(billingDocuments.id, paymentAllocations.billingDocumentId))
    .where(and(gte(bankTransactions.bookingDate, from), lte(bankTransactions.bookingDate, to)));
  const payLines = [["Buchungstag", "Zahler", "Betrag", "Beleg", "Verwendungszweck"].join(";")];
  for (const p of pays) {
    payLines.push(
      [p.t.bookingDate, p.t.counterpartyName, euro(p.amount), p.number, p.t.purpose]
        .map(csvCell)
        .join(";"),
    );
  }
  files[`zahlungseingaenge-${monthStr}.csv`] = encodeCp1252(`${payLines.join("\r\n")}\r\n`);

  const open = await loadReceivables(db);
  const opLines = [
    ["Belegnummer", "Kunde", "Datum", "Fällig", "Brutto", "Bezahlt", "Offen"].join(";"),
  ];
  for (const r of open) {
    opLines.push(
      [
        r.number,
        r.contactName,
        r.issueDate,
        r.dueDate,
        euro(r.grossCents),
        euro(r.paidCents),
        euro(r.openCents),
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  files[`offene-posten-${to}.csv`] = encodeCp1252(`${opLines.join("\r\n")}\r\n`);
  if (notes.length > 0) files["hinweise.txt"] = strToU8(`${notes.join("\n")}\n`);

  return { zip: zipSync(files, { level: 6 }), files: Object.keys(files).sort(), notes };
}
