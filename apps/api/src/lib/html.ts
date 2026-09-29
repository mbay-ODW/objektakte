/** Minimaler, sicherer HTML-Baukasten für PDF-Vorlagen. */

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Zeilenumbrüche erhalten. */
export function escMultiline(value: unknown): string {
  return esc(value).replace(/\n/g, "<br>");
}

export function formatDateDe(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
  }).format(date);
}

export function formatDateTimeDe(d: Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function formatCents(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);
}

export const BASE_CSS = `
  @page { size: A4; margin: 18mm 16mm 20mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 10pt; color: #1a1a1a; line-height: 1.4; }
  h1 { font-size: 16pt; margin: 0 0 4mm; }
  h2 { font-size: 12pt; margin: 6mm 0 2mm; border-bottom: 0.3mm solid #999; padding-bottom: 1mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 1.2mm 1.5mm; }
  th { background: #eee; font-weight: 600; }
  tr { page-break-inside: avoid; }
  .muted { color: #666; }
  .right { text-align: right; }
  .small { font-size: 8.5pt; }
`;
