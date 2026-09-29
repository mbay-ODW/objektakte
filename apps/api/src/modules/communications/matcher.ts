/**
 * Zuordnung eingehender/ausgehender Nachrichten zu Kontakt und Vorgang.
 * Reine Funktion: alle Kandidaten werden vorher geladen, damit die Logik testbar bleibt.
 */

export interface CandidateCase {
  id: string;
  number: string;
  title: string;
  customerId: string;
  status: string;
  /** Kontakte, die über Objektrollen am Vorgang beteiligt sind. */
  relatedContactIds: string[];
  objectLabel: string | null;
  street: string | null;
  city: string | null;
}

export interface MatchInput {
  subject: string | null;
  body: string | null;
  /** Kontakt-IDs, deren Kanäle zu den Gegenüber-Adressen passen. */
  contactIds: string[];
  /** Alle Vorgänge der gefundenen Kontakte plus Vorgänge, deren Nummer im Text vorkommt. */
  cases: CandidateCase[];
}

export interface MatchResult {
  contactId: string | null;
  caseId: string | null;
  confidence: number;
  reason: string;
  candidates: { caseId: string; number: string; score: number }[];
}

const CLOSED = new Set(["abgeschlossen", "storniert"]);

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/str\./g, "strasse");
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Findet Vorgangsnummern als ganze Wörter im Text. */
export function findCaseNumbers(text: string, numbers: string[]): string[] {
  const hits = new Set<string>();
  for (const n of numbers) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(n)}($|[^\\p{L}\\p{N}])`, "iu");
    if (re.test(text)) hits.add(n);
  }
  return [...hits];
}

/** Bewertet, wie gut ein Vorgang inhaltlich zum Text passt (Adresse, Objekt, Titel). */
export function scoreCase(text: string, c: CandidateCase): number {
  const t = normalizeText(text);
  let score = 0;
  if (c.street) {
    const street = normalizeText(c.street);
    const streetName = street.replace(/\s*\d+\s*\w?$/, "").trim();
    if (street && t.includes(street)) score += 0.5;
    else if (streetName.length >= 4 && t.includes(streetName)) score += 0.3;
  }
  if (c.objectLabel) {
    const label = normalizeText(c.objectLabel);
    if (label.length >= 4 && t.includes(label)) score += 0.3;
  }
  if (c.city) {
    const city = normalizeText(c.city);
    if (city.length >= 3 && t.includes(city)) score += 0.1;
  }
  const titleWords = normalizeText(c.title)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5);
  const hitWords = titleWords.filter((w) => t.includes(w)).length;
  if (titleWords.length > 0) score += 0.2 * (hitWords / titleWords.length);
  return Math.min(score, 1);
}

export function matchCommunication(input: MatchInput): MatchResult {
  const text = [input.subject, input.body].filter(Boolean).join("\n");
  const byNumber = findCaseNumbers(
    text,
    input.cases.map((c) => c.number),
  );

  // 1. Eindeutige Vorgangsnummer im Text schlägt alles andere.
  if (byNumber.length === 1) {
    const kase = input.cases.find((c) => c.number === byNumber[0]);
    if (kase) {
      const contactId =
        input.contactIds.length === 1 ? (input.contactIds[0] ?? null) : kase.customerId;
      return {
        contactId,
        caseId: kase.id,
        confidence: 0.95,
        reason: `Vorgangsnummer ${kase.number} im Text`,
        candidates: [{ caseId: kase.id, number: kase.number, score: 0.95 }],
      };
    }
  }

  if (input.contactIds.length === 0) {
    return {
      contactId: null,
      caseId: null,
      confidence: 0,
      reason: "Absender/Empfänger unbekannt",
      candidates: [],
    };
  }

  if (input.contactIds.length > 1) {
    return {
      contactId: null,
      caseId: null,
      confidence: 0,
      reason: "Adresse gehört zu mehreren Kontakten",
      candidates: [],
    };
  }

  const contactId = input.contactIds[0] ?? null;
  const open = input.cases.filter(
    (c) =>
      !CLOSED.has(c.status) &&
      (c.customerId === contactId ||
        (contactId !== null && c.relatedContactIds.includes(contactId))),
  );

  if (open.length === 0) {
    return {
      contactId,
      caseId: null,
      confidence: 0.5,
      reason: "Kontakt erkannt, aber kein offener Vorgang (mögliche Neuanfrage)",
      candidates: [],
    };
  }

  if (open.length === 1) {
    const only = open[0] as CandidateCase;
    return {
      contactId,
      caseId: only.id,
      confidence: 0.8,
      reason: "einziger offener Vorgang des Kontakts",
      candidates: [{ caseId: only.id, number: only.number, score: 0.8 }],
    };
  }

  const scored = open
    .map((c) => ({
      caseId: c.id,
      number: c.number,
      score: Math.round(scoreCase(text, c) * 1000) / 1000,
    }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (best && best.score >= 0.3 && (!second || best.score - second.score >= 0.2)) {
    return {
      contactId,
      caseId: best.caseId,
      confidence: Math.min(0.5 + best.score / 2, 0.9),
      reason: `inhaltlicher Treffer (Objekt/Adresse/Titel) auf ${best.number}`,
      candidates: scored,
    };
  }
  return {
    contactId,
    caseId: null,
    confidence: 0.5,
    reason: "Kontakt erkannt, mehrere offene Vorgänge – bitte zuordnen",
    candidates: scored,
  };
}
