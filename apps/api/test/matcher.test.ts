import { describe, expect, it } from "vitest";
import {
  type CandidateCase,
  findCaseNumbers,
  matchCommunication,
  scoreCase,
} from "../src/modules/communications/matcher.js";

const kase = (over: Partial<CandidateCase>): CandidateCase => ({
  id: "c1",
  number: "ISFP-311",
  title: "iSFP Einfamilienhaus",
  customerId: "k1",
  status: "in_bearbeitung",
  relatedContactIds: [],
  objectLabel: null,
  street: null,
  city: null,
  ...over,
});

describe("findCaseNumbers", () => {
  it("findet Nummern nur als ganze Wörter", () => {
    expect(
      findCaseNumbers("Betreff: Unterlagen zu ISFP-311 anbei", ["ISFP-311", "ISFP-31"]),
    ).toEqual(["ISFP-311"]);
    expect(findCaseNumbers("isfp-311, bitte prüfen", ["ISFP-311"])).toEqual(["ISFP-311"]);
    expect(findCaseNumbers("ISFP-3110", ["ISFP-311"])).toEqual([]);
  });
});

describe("scoreCase", () => {
  it("erkennt Straßen auch mit Abkürzung und Umlauten", () => {
    const c = kase({ street: "Hauptstraße 12", city: "Musterstadt" });
    expect(scoreCase("Termin in der Hauptstr. 12", c)).toBeGreaterThanOrEqual(0.5);
    expect(scoreCase("irgendwas anderes", c)).toBe(0);
  });
});

describe("matchCommunication", () => {
  it("Vorgangsnummer schlägt alles", () => {
    const r = matchCommunication({
      subject: "Re: BAFA-297",
      body: null,
      contactIds: [],
      cases: [kase({ id: "a", number: "BAFA-297", customerId: "k9" })],
    });
    expect(r).toMatchObject({ caseId: "a", contactId: "k9", confidence: 0.95 });
  });

  it("einziger offener Vorgang des Kontakts", () => {
    const r = matchCommunication({
      subject: "Frage",
      body: null,
      contactIds: ["k1"],
      cases: [kase({ id: "a" }), kase({ id: "b", number: "X-1", status: "abgeschlossen" })],
    });
    expect(r).toMatchObject({ caseId: "a", confidence: 0.8 });
  });

  it("berücksichtigt über Objektrollen beteiligte Kontakte (z. B. Verwaltung)", () => {
    const r = matchCommunication({
      subject: "Frage",
      body: null,
      contactIds: ["verwaltung"],
      cases: [kase({ id: "a", customerId: "weg", relatedContactIds: ["verwaltung"] })],
    });
    expect(r.caseId).toBe("a");
  });

  it("wählt bei mehreren Vorgängen nach Inhalt oder lässt offen", () => {
    const cases = [
      kase({ id: "a", number: "A-1", street: "Hauptstraße 12" }),
      kase({ id: "b", number: "B-2", street: "Lindenweg 3" }),
    ];
    const clear = matchCommunication({
      subject: "Fenster Lindenweg 3",
      body: null,
      contactIds: ["k1"],
      cases,
    });
    expect(clear.caseId).toBe("b");
    const unclear = matchCommunication({
      subject: "Kurze Frage",
      body: null,
      contactIds: ["k1"],
      cases,
    });
    expect(unclear.caseId).toBeNull();
    expect(unclear.contactId).toBe("k1");
    expect(unclear.candidates).toHaveLength(2);
  });

  it("meldet unbekannte und mehrdeutige Absender", () => {
    expect(
      matchCommunication({ subject: null, body: null, contactIds: [], cases: [] }).reason,
    ).toContain("unbekannt");
    expect(
      matchCommunication({ subject: null, body: null, contactIds: ["a", "b"], cases: [] }).reason,
    ).toContain("mehreren");
  });
});
