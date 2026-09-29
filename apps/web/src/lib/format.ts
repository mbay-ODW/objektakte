/** Formatierung für die deutsche Oberfläche. */

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Berlin",
});
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});
const euroFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** ISO-Datum (YYYY-MM-DD) oder Zeitstempel als TT.MM.JJJJ. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "–";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}.${m}.${y}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFmt.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFmt.format(date);
}

export function formatCents(cents: number | null | undefined): string {
  return cents == null ? "–" : euroFmt.format(cents / 100);
}

/** Cent-Betrag als Eingabewert ("1234,56"). */
export function centsInput(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/** Tage zwischen zwei ISO-Daten (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Heutiges Datum (lokal) als ISO-String. */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Relative Fälligkeit für Fristen („in 3 Tagen“, „seit 2 Tagen überfällig“). */
export function dueLabel(dueDate: string, today = todayIso()): string {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return "heute fällig";
  if (diff === 1) return "morgen fällig";
  if (diff > 1) return `in ${diff} Tagen`;
  if (diff === -1) return "seit 1 Tag überfällig";
  return `seit ${-diff} Tagen überfällig`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
