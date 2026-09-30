import { describe, expect, it } from "vitest";
import { centsInput, daysBetween, dueLabel, formatBytes, formatCents, formatDate } from "./format";

describe("Formatierung", () => {
  it("formatiert ISO-Daten deutsch", () => {
    expect(formatDate("2026-03-05")).toBe("05.03.2026");
    expect(formatDate(null)).toBe("–");
  });

  it("formatiert Beträge", () => {
    expect(formatCents(123456)).toMatch(/1\.234,56\s€/);
    expect(centsInput(123456)).toBe("1234,56");
    expect(centsInput(null)).toBe("");
  });

  it("berechnet Fälligkeiten", () => {
    expect(daysBetween("2026-01-30", "2026-02-02")).toBe(3);
    expect(dueLabel("2026-05-01", "2026-05-01")).toBe("heute fällig");
    expect(dueLabel("2026-05-04", "2026-05-01")).toBe("in 3 Tagen");
    expect(dueLabel("2026-04-29", "2026-05-01")).toBe("seit 2 Tagen überfällig");
  });

  it("formatiert Dateigrößen", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });
});
