import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween } from "../src/lib/dates.js";

describe("addMonths", () => {
  it.each([
    ["2026-01-15", 36, "2029-01-15"],
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-08-31", 6, "2027-02-28"],
    ["2026-03-31", -1, "2026-02-28"],
    ["2011-05-10", 180, "2026-05-10"],
  ])("%s + %i Monate = %s", (d, m, expected) => {
    expect(addMonths(d, m)).toBe(expected);
  });

  it("rechnet Tage und Abstände", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-01-01", "2026-03-01")).toBe(59);
  });
});
