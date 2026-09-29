/**
 * Kanonisches Rechnungsmodell nach EN 16931. Aus diesem Modell werden PDF und E-Rechnung
 * (CII für ZUGFeRD/Factur-X und XRechnung) erzeugt – beide aus derselben Quelle.
 * Beträge in Cent (Ganzzahl), Mengen als Dezimalzahl.
 */

export type TaxCategory = "S" | "Z" | "E" | "AE" | "O";

/** UNTDID 1001 Dokumentart. */
export const TYPE_CODES = {
  rechnung: "380",
  schlussrechnung: "380",
  abschlagsrechnung: "326",
  stornorechnung: "381",
  gutschrift: "381",
} as const;

export type InvoiceKind = keyof typeof TYPE_CODES;

export interface Party {
  /** BT-29/BT-46: Kennung (z. B. Kundennummer; beim Verkäufer nötig, wenn keine USt-IdNr. vorliegt) */
  id?: string | null;
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  vatId: string | null;
  taxNumber: string | null;
  /** Elektronische Adresse (BT-34/BT-49), hier E-Mail */
  email: string | null;
  contactName: string | null;
  phone: string | null;
}

export interface Line {
  position: number;
  articleCode: string | null;
  name: string;
  description: string | null;
  /** Menge, bis zu 4 Nachkommastellen */
  quantity: number;
  /** UN/ECE Rec. 20, z. B. C62 (Stück), HUR (Stunde), LS (Pauschale) */
  unitCode: string;
  unitPriceCents: number;
  taxCategory: TaxCategory;
  taxRatePercent: number;
}

export interface CanonicalInvoice {
  kind: InvoiceKind;
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  /** BT-10: Leitweg-ID (öffentliche Auftraggeber) oder sonstige Käuferreferenz */
  buyerReference: string | null;
  orderReference: string | null;
  /** BT-25: Vorgängerrechnung (Storno, Schlussrechnung) */
  precedingInvoice: { number: string; issueDate: string | null } | null;
  serviceDate: string | null;
  servicePeriod: { start: string; end: string } | null;
  seller: Party;
  buyer: Party;
  payment: {
    iban: string | null;
    bic: string | null;
    accountName: string | null;
    termsText: string | null;
    reference: string;
  };
  /** Freitext-Hinweise (BT-22), z. B. Einleitung/Schlusstext, § 19 UStG */
  notes: string[];
  /** Grund für Steuerbefreiung je Kategorie (BT-120) */
  exemptionReasons: Partial<Record<TaxCategory, string>>;
  lines: Line[];
  /** BT-113: bereits gezahlte/abgerechnete Beträge (Schlussrechnung) */
  prepaidCents: number;
}

export interface TaxBreakdown {
  category: TaxCategory;
  ratePercent: number;
  basisCents: number;
  taxCents: number;
  exemptionReason: string | null;
}

export interface Totals {
  lineNets: number[];
  /** BT-106 */
  lineTotalCents: number;
  /** BT-109 */
  taxBasisCents: number;
  /** BT-110 */
  taxCents: number;
  /** BT-112 */
  grandTotalCents: number;
  /** BT-113 */
  prepaidCents: number;
  /** BT-115 */
  duePayableCents: number;
  breakdown: TaxBreakdown[];
}

/** Rundung kaufmännisch (half away from zero) auf ganze Cent. */
export function roundCents(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON * Math.abs(value));
}

export function lineNetCents(line: Pick<Line, "quantity" | "unitPriceCents">): number {
  // Menge mit max. 4 Nachkommastellen → ganzzahlig rechnen, um Gleitkommafehler zu vermeiden
  const qty = Math.round(line.quantity * 10_000);
  return roundCents((qty * line.unitPriceCents) / 10_000);
}

/**
 * Berechnet Summen und Steueraufschlüsselung. Die Steuer wird je Kategorie/Satz auf die
 * Summe der Nettobeträge gerechnet (nicht je Position), wie in EN 16931 vorgesehen.
 */
export function computeTotals(
  inv: Pick<CanonicalInvoice, "lines" | "prepaidCents" | "exemptionReasons">,
): Totals {
  const lineNets = inv.lines.map(lineNetCents);
  const groups = new Map<string, TaxBreakdown>();
  inv.lines.forEach((l, i) => {
    const key = `${l.taxCategory}|${l.taxRatePercent}`;
    const g = groups.get(key) ?? {
      category: l.taxCategory,
      ratePercent: l.taxRatePercent,
      basisCents: 0,
      taxCents: 0,
      exemptionReason: inv.exemptionReasons[l.taxCategory] ?? null,
    };
    g.basisCents += lineNets[i] ?? 0;
    groups.set(key, g);
  });
  const breakdown = [...groups.values()]
    .map((g) => ({ ...g, taxCents: roundCents((g.basisCents * g.ratePercent) / 100) }))
    .sort((a, b) => a.category.localeCompare(b.category) || b.ratePercent - a.ratePercent);
  const lineTotalCents = lineNets.reduce((s, n) => s + n, 0);
  const taxCents = breakdown.reduce((s, g) => s + g.taxCents, 0);
  const grandTotalCents = lineTotalCents + taxCents;
  return {
    lineNets,
    lineTotalCents,
    taxBasisCents: lineTotalCents,
    taxCents,
    grandTotalCents,
    prepaidCents: inv.prepaidCents,
    duePayableCents: grandTotalCents - inv.prepaidCents,
    breakdown,
  };
}

/** Zulässige Einheiten (Auszug UN/ECE Rec. 20) mit deutscher Bezeichnung. */
export const UNIT_CODES: Record<string, string> = {
  C62: "Stück",
  H87: "Stück",
  HUR: "Std.",
  MIN: "Min.",
  DAY: "Tag",
  LS: "pauschal",
  KMT: "km",
  MTK: "m²",
  MTR: "m",
  E48: "Leistung",
};

export const XRECHNUNG_GUIDELINE =
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";
export const EN16931_GUIDELINE = "urn:cen.eu:en16931:2017";
