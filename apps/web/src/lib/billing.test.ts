import { describe, expect, it } from "vitest";
import {
  centsToInput,
  computeDraftTotals,
  eurosToCents,
  type LineDraft,
  lineNetCents,
  parseDecimal,
  toPayload,
} from "./billing";

const draft = (over: Partial<LineDraft> = {}): LineDraft => ({
  articleCode: "",
  name: "Energieberatung",
  description: "",
  quantity: "1",
  unitCode: "HUR",
  unitPrice: "100,00",
  taxCategory: "S",
  taxRatePercent: "19",
  ...over,
});

describe("Beleg-Eingaben", () => {
  it("liest deutsche und englische Dezimalzahlen", () => {
    expect(parseDecimal("1.234,56")).toBe(1234.56);
    expect(parseDecimal("12.5")).toBe(12.5);
    expect(parseDecimal("-3,5")).toBe(-3.5);
    expect(parseDecimal("abc")).toBeNaN();
    expect(eurosToCents("99,99 €")).toBe(9999);
    expect(eurosToCents("")).toBeNull();
    expect(centsToInput(123456)).toBe("1234,56");
  });

  it("rundet Positionsbeträge kaufmännisch", () => {
    expect(lineNetCents(1.5, 3333)).toBe(5000);
    expect(lineNetCents(0.3333, 100)).toBe(33);
    expect(lineNetCents(-1, 1000)).toBe(-1000);
  });

  it("prüft Zeilen und erzeugt API-Eingaben", () => {
    expect(toPayload(draft(), 0)).toEqual({
      articleCode: null,
      name: "Energieberatung",
      description: null,
      quantity: 1,
      unitCode: "HUR",
      unitPriceCents: 10000,
      taxCategory: "S",
      taxRatePercent: 19,
    });
    expect(toPayload(draft({ name: " " }), 1)).toBe("Position 2: Bezeichnung fehlt");
    expect(toPayload(draft({ quantity: "0" }), 0)).toBe("Position 1: Menge ungültig");
    expect(toPayload(draft({ unitPrice: "x" }), 0)).toBe("Position 1: Preis ungültig");
    expect(toPayload(draft({ taxCategory: "E", taxRatePercent: "19" }), 0)).toMatchObject({
      taxRatePercent: 0,
    });
  });

  it("berechnet Summen je Steuersatz", () => {
    const lines = [
      toPayload(draft({ quantity: "2", unitPrice: "100,00" }), 0),
      toPayload(draft({ unitPrice: "50,00", taxRatePercent: "7" }), 1),
      toPayload(draft({ unitPrice: "10,00" }), 2),
    ].filter((l) => typeof l !== "string");
    const t = computeDraftTotals(lines);
    expect(t.netCents).toBe(26000);
    expect(t.groups).toEqual([
      { category: "S", ratePercent: 19, basisCents: 21000, taxCents: 3990 },
      { category: "S", ratePercent: 7, basisCents: 5000, taxCents: 350 },
    ]);
    expect(t.grossCents).toBe(30340);
  });

  it("behandelt Kleinunternehmer steuerfrei", () => {
    const line = toPayload(draft(), 0);
    if (typeof line === "string") throw new Error(line);
    const t = computeDraftTotals([line], true);
    expect(t.taxCents).toBe(0);
    expect(t.groups[0]?.category).toBe("E");
  });
});
