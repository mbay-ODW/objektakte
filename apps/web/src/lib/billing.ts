/**
 * Beleg-Hilfen für die Oberfläche: Eingaben lesen und Summen live berechnen.
 * Die Berechnung entspricht der API (Steuer je Kategorie/Satz auf die Nettosumme, kaufmännisch
 * gerundet); maßgeblich bleibt die Prüfung der API.
 */
import type { TaxCategory } from "./labels";

export interface LineDraft {
  articleCode: string;
  name: string;
  description: string;
  quantity: string;
  unitCode: string;
  /** Einzelpreis netto in Euro als Eingabetext ("1.234,56") */
  unitPrice: string;
  taxCategory: TaxCategory;
  taxRatePercent: string;
}

export interface LinePayload {
  articleCode: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unitCode: string;
  unitPriceCents: number;
  taxCategory: TaxCategory;
  taxRatePercent: number;
}

/** Deutsche oder englische Dezimalschreibweise lesen; ungültig → NaN. */
export function parseDecimal(text: string): number {
  const t = text.trim().replace(/\s|€/g, "");
  if (t === "") return Number.NaN;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return /^-?\d*\.?\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
}

export function roundCents(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON * Math.abs(value));
}

export function lineNetCents(quantity: number, unitPriceCents: number): number {
  const qty = Math.round(quantity * 10_000);
  return roundCents((qty * unitPriceCents) / 10_000);
}

/** Euro-Eingabe in Cent; ungültig → null. */
export function eurosToCents(text: string): number | null {
  const n = parseDecimal(text);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Formular-Zeile in API-Eingabe; Fehlermeldung, falls unvollständig. */
export function toPayload(line: LineDraft, index: number): LinePayload | string {
  const n = index + 1;
  const quantity = parseDecimal(line.quantity);
  const price = eurosToCents(line.unitPrice);
  const rate = line.taxCategory === "S" ? parseDecimal(line.taxRatePercent) : 0;
  if (!line.name.trim()) return `Position ${n}: Bezeichnung fehlt`;
  if (!Number.isFinite(quantity) || quantity === 0) return `Position ${n}: Menge ungültig`;
  if (price === null) return `Position ${n}: Preis ungültig`;
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return `Position ${n}: Steuersatz ungültig`;
  return {
    articleCode: line.articleCode || null,
    name: line.name.trim(),
    description: line.description.trim() || null,
    quantity,
    unitCode: line.unitCode,
    unitPriceCents: price,
    taxCategory: line.taxCategory,
    taxRatePercent: rate,
  };
}

export interface TaxGroup {
  category: TaxCategory;
  ratePercent: number;
  basisCents: number;
  taxCents: number;
}

export interface DraftTotals {
  netCents: number;
  taxCents: number;
  grossCents: number;
  groups: TaxGroup[];
}

/**
 * Summen gültiger Zeilen. Kleinunternehmer: steuerpflichtige Positionen werden wie in der API
 * steuerfrei (Kategorie E) behandelt.
 */
export function computeDraftTotals(lines: LinePayload[], smallBusiness = false): DraftTotals {
  const groups = new Map<string, TaxGroup>();
  let netCents = 0;
  for (const l of lines) {
    const category: TaxCategory = smallBusiness && l.taxCategory === "S" ? "E" : l.taxCategory;
    const rate = category === "S" ? l.taxRatePercent : 0;
    const net = lineNetCents(l.quantity, l.unitPriceCents);
    netCents += net;
    const key = `${category}|${rate}`;
    const g = groups.get(key) ?? { category, ratePercent: rate, basisCents: 0, taxCents: 0 };
    g.basisCents += net;
    groups.set(key, g);
  }
  const list = [...groups.values()]
    .map((g) => ({ ...g, taxCents: roundCents((g.basisCents * g.ratePercent) / 100) }))
    .sort((a, b) => a.category.localeCompare(b.category) || b.ratePercent - a.ratePercent);
  const taxCents = list.reduce((s, g) => s + g.taxCents, 0);
  return { netCents, taxCents, grossCents: netCents + taxCents, groups: list };
}
