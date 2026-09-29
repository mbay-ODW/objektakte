/**
 * DATEV-Buchungsstapel (Format EXTF, Version 700). Es werden die ersten 14 Standardspalten
 * geschrieben; weitere Spalten sind optional. Vor produktiver Nutzung mit der Steuerberatung
 * einen Probeimport durchführen.
 */

export interface DatevHeader {
  consultantNumber: number;
  clientNumber: number;
  fiscalYearStart: string; // YYYYMMDD
  accountLength: number;
  from: string; // YYYY-MM-DD
  to: string;
  label: string;
  createdAt: Date;
}

export interface DatevBooking {
  amountCents: number;
  debitCredit: "S" | "H";
  account: number;
  contraAccount: number;
  date: string; // YYYY-MM-DD
  document1: string;
  text: string;
}

const COLUMNS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Kurs",
  "Basis-Umsatz",
  "WKZ Basis-Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Belegfeld 2",
  "Skonto",
  "Buchungstext",
];

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const ymd = (d: string) => d.replace(/-/g, "");

function timestamp(d: Date) {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${p(d.getUTCMilliseconds(), 3)}`;
}

export function datevAmount(cents: number): string {
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Belegfeld 1: max. 36 Zeichen, nur zulässige Zeichen. */
function documentField(s: string) {
  return s.replace(/[^A-Za-z0-9$&%*+\-/]/g, "").slice(0, 36);
}

export function buildDatevCsv(h: DatevHeader, bookings: DatevBooking[]): string {
  const header = [
    q("EXTF"),
    "700",
    "21",
    q("Buchungsstapel"),
    "13",
    timestamp(h.createdAt),
    "",
    q("RE"),
    q(""),
    q(""),
    String(h.consultantNumber),
    String(h.clientNumber),
    h.fiscalYearStart,
    String(h.accountLength),
    ymd(h.from),
    ymd(h.to),
    q(h.label.slice(0, 30)),
    q(""),
    "1",
    "0",
    "0",
    q("EUR"),
    "",
    q(""),
    "",
    "",
    q("03"),
    "",
    "",
    q(""),
    q(""),
  ].join(";");
  const lines = bookings.map((b) => {
    const [, m, d] = b.date.split("-") as [string, string, string];
    return [
      datevAmount(b.amountCents),
      q(b.debitCredit),
      q("EUR"),
      "",
      "",
      q(""),
      String(b.account),
      String(b.contraAccount),
      q(""),
      `${d}${m}`,
      q(documentField(b.document1)),
      q(""),
      "",
      q(
        b.text
          .replace(/[\r\n;]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60),
      ),
    ].join(";");
  });
  return [header, COLUMNS.map(q).join(";"), ...lines].join("\r\n") + "\r\n";
}
