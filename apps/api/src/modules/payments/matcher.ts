/** Zuordnung von Zahlungseingängen zu offenen Posten (reine Funktion). */

export interface OpenItem {
  billingDocumentId: string;
  number: string;
  openCents: number;
  contactName: string;
}

export interface TxInput {
  amountCents: number;
  purpose: string | null;
  counterpartyName: string | null;
}

export interface Suggestion {
  billingDocumentId: string;
  number: string;
  amountCents: number;
  score: number;
  reason: string;
}

/** Vergleichsform einer Belegnummer: nur Buchstaben und Ziffern, Großschreibung. */
export function compactNumber(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter(
        (t) =>
          t.length >= 3 && !["gmbh", "und", "der", "die", "das", "herr", "frau", "e.v"].includes(t),
      ),
  );
}

/**
 * Anteil gemeinsamer Namensbestandteile (0–1). Ein Bestandteil gilt auch als gleich, wenn
 * einer mit dem anderen beginnt (mind. 5 Zeichen), z. B. „Gemeindekasse“ ↔ „Gemeinde“.
 */
export function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const ta = [...tokens(a)];
  const tb = [...tokens(b)];
  if (ta.length === 0 || tb.length === 0) return 0;
  const same = (x: string, y: string) =>
    x === y || (Math.min(x.length, y.length) >= 5 && (x.startsWith(y) || y.startsWith(x)));
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const common = small.filter((x) => large.some((y) => same(x, y))).length;
  return common / small.length;
}

/**
 * Liefert Vorschläge, sortiert nach Score. Eine Aufteilung auf mehrere Belege wird
 * vorgeschlagen, wenn mehrere Belegnummern genannt sind und die Summe exakt passt.
 */
export function suggestAllocations(tx: TxInput, items: OpenItem[]): Suggestion[] {
  if (tx.amountCents <= 0) return [];
  const purpose = compactNumber(tx.purpose ?? "");
  const mentioned = items.filter((i) => {
    const n = compactNumber(i.number);
    return n.length >= 4 && purpose.includes(n);
  });

  // Mehrere genannte Belege, deren offene Beträge zusammen exakt passen
  if (mentioned.length > 1) {
    const sum = mentioned.reduce((s, i) => s + i.openCents, 0);
    if (sum === tx.amountCents) {
      return mentioned.map((i) => ({
        billingDocumentId: i.billingDocumentId,
        number: i.number,
        amountCents: i.openCents,
        score: 0.9,
        reason: "mehrere Belegnummern im Verwendungszweck, Summe passt",
      }));
    }
  }

  if (mentioned.length === 1) {
    const i = mentioned[0] as OpenItem;
    const exact = i.openCents === tx.amountCents;
    return [
      {
        billingDocumentId: i.billingDocumentId,
        number: i.number,
        amountCents: Math.min(i.openCents, tx.amountCents),
        score: exact ? 0.97 : 0.8,
        reason: exact
          ? "Belegnummer und Betrag stimmen"
          : "Belegnummer im Verwendungszweck, Teilzahlung",
      },
    ];
  }

  // Ohne Belegnummer: exakter Betrag, gewichtet nach Namensähnlichkeit
  return items
    .filter((i) => i.openCents === tx.amountCents)
    .map((i) => {
      const sim = nameSimilarity(tx.counterpartyName, i.contactName);
      return {
        billingDocumentId: i.billingDocumentId,
        number: i.number,
        amountCents: i.openCents,
        score: Math.round((0.55 + 0.35 * sim) * 1000) / 1000,
        reason: sim > 0 ? "Betrag stimmt, Name ähnlich" : "Betrag stimmt",
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Wählt die automatisch zu übernehmenden Vorschläge (eindeutig und über dem Schwellwert). */
export function autoAllocations(suggestions: Suggestion[], threshold: number): Suggestion[] {
  if (suggestions.length === 0) return [];
  const multi = suggestions.every((s) => s.reason.startsWith("mehrere"));
  if (multi) return suggestions.every((s) => s.score >= threshold) ? suggestions : [];
  const [best, second] = suggestions;
  if (!best || best.score < threshold) return [];
  if (second && second.score >= best.score - 0.05) return [];
  return [best];
}
