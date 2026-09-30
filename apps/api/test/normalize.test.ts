import { describe, expect, it } from "vitest";
import { normalizeChannelValue, normalizePhone } from "../src/lib/normalize.js";

describe("normalizePhone", () => {
  it.each([
    ["0170 1234567", "491701234567"],
    ["+49 (0)170-1234567", "4901701234567"],
    ["+49 170 1234567", "491701234567"],
    ["0049 6061 12345", "49606112345"],
    ["06061/12345", "49606112345"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe("normalizeChannelValue", () => {
  it("normalisiert E-Mail und Website", () => {
    expect(normalizeChannelValue("email", "  Info@Example.ORG ")).toBe("info@example.org");
    expect(normalizeChannelValue("website", "https://Example.org/")).toBe("example.org");
  });
});
