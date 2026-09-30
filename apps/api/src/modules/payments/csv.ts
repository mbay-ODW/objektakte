/**
 * CSV-Import von Kontoumsätzen. Banken exportieren sehr unterschiedlich; deshalb werden
 * Spaltennamen, Trennzeichen sowie Datums- und Zahlenformat konfiguriert, nicht erraten.
 */

export interface CsvMapping {
  delimiter: ";" | "," | "\t";
  /** "dd.mm.yyyy" oder "yyyy-mm-dd" */
  dateFormat: "dd.mm.yyyy" | "yyyy-mm-dd";
  /** Dezimaltrennzeichen der Beträge */
  decimal: "," | ".";
  /** Zeilen vor der Kopfzeile überspringen (manche Banken schreiben Kontoinfos davor). */
  skipLines: number;
  columns: {
    bookingDate: string;
    valueDate?: string;
    amount: string;
    /** optional getrennte Soll/Haben-Spalte (z. B. "S"/"H"); sonst Vorzeichen im Betrag */
    debitCredit?: string;
    currency?: string;
    counterpartyName?: string;
    counterpartyIban?: string;
    purpose: string;
    reference?: string;
    externalId?: string;
  };
}

export interface ParsedTransaction {
  externalId: string | null;
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  currency: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  purpose: string | null;
  reference: string | null;
}

/** RFC-4180-kompatibler Parser (Anführungszeichen, eingebettete Trennzeichen/Zeilenumbrüche). */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export function parseAmountToCents(raw: string, decimal: "," | "."): number {
  let s = raw.trim().replace(/\s|€|EUR/gi, "");
  if (decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) throw new Error(`Ungültiger Betrag "${raw}"`);
  return Math.round(Number(s) * 100);
}

export function parseDate(raw: string, format: CsvMapping["dateFormat"]): string {
  const s = raw.trim();
  if (format === "yyyy-mm-dd") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Ungültiges Datum "${raw}"`);
    return s;
  }
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s);
  if (!m) throw new Error(`Ungültiges Datum "${raw}"`);
  const [, d, mo, y] = m as unknown as [string, string, string, string];
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function parseBankCsv(
  text: string,
  mapping: CsvMapping,
): { transactions: ParsedTransaction[]; errors: { line: number; message: string }[] } {
  const rows = parseCsv(text, mapping.delimiter).slice(mapping.skipLines);
  const [header, ...data] = rows;
  if (!header) return { transactions: [], errors: [{ line: 1, message: "Keine Kopfzeile" }] };
  const index = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const col = (name: string | undefined) =>
    name ? index.get(name.trim().toLowerCase()) : undefined;
  const missing = (["bookingDate", "amount", "purpose"] as const).filter(
    (k) => col(mapping.columns[k]) === undefined,
  );
  if (missing.length > 0) {
    return {
      transactions: [],
      errors: [
        {
          line: mapping.skipLines + 1,
          message: `Spalte(n) nicht gefunden: ${missing.map((k) => mapping.columns[k]).join(", ")}`,
        },
      ],
    };
  }
  const get = (row: string[], name: string | undefined) => {
    const i = col(name);
    const v = i === undefined ? undefined : row[i]?.trim();
    return v ? v : null;
  };

  const transactions: ParsedTransaction[] = [];
  const errors: { line: number; message: string }[] = [];
  data.forEach((row, i) => {
    const line = mapping.skipLines + i + 2;
    try {
      let amountCents = parseAmountToCents(get(row, mapping.columns.amount) ?? "", mapping.decimal);
      const dc = get(row, mapping.columns.debitCredit)?.toUpperCase();
      if (dc === "S" || dc === "D" || dc === "SOLL") amountCents = -Math.abs(amountCents);
      if (dc === "H" || dc === "C" || dc === "HABEN") amountCents = Math.abs(amountCents);
      const valueDate = get(row, mapping.columns.valueDate);
      transactions.push({
        externalId: get(row, mapping.columns.externalId),
        bookingDate: parseDate(get(row, mapping.columns.bookingDate) ?? "", mapping.dateFormat),
        valueDate: valueDate ? parseDate(valueDate, mapping.dateFormat) : null,
        amountCents,
        currency: get(row, mapping.columns.currency) ?? "EUR",
        counterpartyName: get(row, mapping.columns.counterpartyName),
        counterpartyIban: get(row, mapping.columns.counterpartyIban)?.replace(/\s/g, "") ?? null,
        purpose: get(row, mapping.columns.purpose),
        reference: get(row, mapping.columns.reference),
      });
    } catch (err) {
      errors.push({ line, message: err instanceof Error ? err.message : String(err) });
    }
  });
  return { transactions, errors };
}
