import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import type { Services } from "../../adapters/index.js";
import type { DbOrTx } from "../../db/client.js";
import {
  bankTransactions,
  billingDocuments,
  contacts,
  documents,
  paymentAllocations,
} from "../../db/schema.js";
import { encodeCp1252 } from "../../lib/cp1252.js";
import { DomainError } from "../../lib/errors.js";
import { getSetting } from "../../lib/settings.js";
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

/**
 * Umsatz je Monat.
 * - soll: nach Rechnungsdatum; stornierte Rechnungen zählen im Monat ihrer Ausstellung,
 *   Stornorechnungen mindern im Monat des Stornos.
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
          inArray(billingDocuments.type, [...RECEIVABLE_TYPES, "stornorechnung"]),
          inArray(billingDocuments.status, ["festgeschrieben", "versendet", "storniert"]),
          gte(billingDocuments.issueDate, from),
          lte(billingDocuments.issueDate, to),
        ),
      );
    for (const d of docs) {
      if (!d.issueDate) continue;
      const sign = d.type === "stornorechnung" ? -1 : 1;
      add(map, month(d.issueDate), sign * d.netCents, sign * d.taxCents, sign * d.grossCents);
    }
  } else {
    const rows = await db
      .select({
        amount: paymentAllocations.amountCents,
        bookingDate: bankTransactions.bookingDate,
        net: billingDocuments.netCents,
        gross: billingDocuments.grossCents,
      })
      .from(paymentAllocations)
      .innerJoin(bankTransactions, eq(bankTransactions.id, paymentAllocations.transactionId))
      .innerJoin(billingDocuments, eq(billingDocuments.id, paymentAllocations.billingDocumentId))
      .where(and(gte(bankTransactions.bookingDate, from), lte(bankTransactions.bookingDate, to)));
    for (const r of rows) {
      const { net, tax } = splitGross(r.amount, r.net, r.gross);
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

function revenueAccount(
  settings: Awaited<ReturnType<typeof getSetting<"datev">>>,
  taxCents: number,
) {
  return taxCents === 0 ? settings.revenueAccounts.exempt : settings.revenueAccounts.standard;
}

export async function datevExport(db: DbOrTx, from: string, to: string, now = new Date()) {
  const settings = await getSetting(db, "datev");
  if (!settings.consultantNumber || !settings.clientNumber) {
    throw new DomainError(422, "DATEV-Einstellungen unvollständig (Berater- und Mandantennummer)");
  }
  const bookings: DatevBooking[] = [];
  if (settings.mode === "ist") {
    const rows = await db
      .select({
        amount: paymentAllocations.amountCents,
        bookingDate: bankTransactions.bookingDate,
        number: billingDocuments.number,
        tax: billingDocuments.taxCents,
        contact: contacts.displayName,
      })
      .from(paymentAllocations)
      .innerJoin(bankTransactions, eq(bankTransactions.id, paymentAllocations.transactionId))
      .innerJoin(billingDocuments, eq(billingDocuments.id, paymentAllocations.billingDocumentId))
      .innerJoin(contacts, eq(contacts.id, billingDocuments.contactId))
      .where(and(gte(bankTransactions.bookingDate, from), lte(bankTransactions.bookingDate, to)));
    for (const r of rows) {
      bookings.push({
        amountCents: r.amount,
        debitCredit: "S",
        account: settings.bankAccount,
        contraAccount: revenueAccount(settings, r.tax),
        date: r.bookingDate,
        document1: r.number ?? "",
        text: r.contact,
      });
    }
  } else {
    const docs = await db
      .select({ doc: billingDocuments, contact: contacts.displayName })
      .from(billingDocuments)
      .innerJoin(contacts, eq(contacts.id, billingDocuments.contactId))
      .where(
        and(
          inArray(billingDocuments.type, [...RECEIVABLE_TYPES, "stornorechnung"]),
          inArray(billingDocuments.status, ["festgeschrieben", "versendet", "storniert"]),
          gte(billingDocuments.issueDate, from),
          lte(billingDocuments.issueDate, to),
        ),
      );
    for (const { doc, contact } of docs) {
      if (!doc.issueDate) continue;
      bookings.push({
        amountCents: doc.grossCents,
        debitCredit: doc.type === "stornorechnung" ? "H" : "S",
        account: settings.debtorAccount,
        contraAccount: revenueAccount(settings, doc.taxCents),
        date: doc.issueDate,
        document1: doc.number ?? "",
        text: contact,
      });
    }
    const pays = await db
      .select({
        amount: paymentAllocations.amountCents,
        bookingDate: bankTransactions.bookingDate,
        number: billingDocuments.number,
        contact: contacts.displayName,
      })
      .from(paymentAllocations)
      .innerJoin(bankTransactions, eq(bankTransactions.id, paymentAllocations.transactionId))
      .innerJoin(billingDocuments, eq(billingDocuments.id, paymentAllocations.billingDocumentId))
      .innerJoin(contacts, eq(contacts.id, billingDocuments.contactId))
      .where(and(gte(bankTransactions.bookingDate, from), lte(bankTransactions.bookingDate, to)));
    for (const p of pays) {
      bookings.push({
        amountCents: p.amount,
        debitCredit: "S",
        account: settings.bankAccount,
        contraAccount: settings.debtorAccount,
        date: p.bookingDate,
        document1: p.number ?? "",
        text: p.contact,
      });
    }
  }
  bookings.sort((a, b) => a.date.localeCompare(b.date) || a.document1.localeCompare(b.document1));
  const fy = `${from.slice(0, 4)}${settings.fiscalYearStart.replace("-", "")}`;
  const csv = buildDatevCsv(
    {
      consultantNumber: settings.consultantNumber,
      clientNumber: settings.clientNumber,
      fiscalYearStart: fy,
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
      const name = pdf.location.split("/").pop() ?? `${doc.number}.pdf`;
      files[`belege/${name}`] = await services.storage.get(pdf.location);
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
