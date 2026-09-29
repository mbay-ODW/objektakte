import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  createSessionToken,
  SESSION_MAX_AGE_S,
  verifySessionToken,
} from "./session";

const SECRET = "a".repeat(40);

describe("Sitzungstoken", () => {
  it("akzeptiert ein frisch ausgestelltes Token", () => {
    expect(verifySessionToken(SECRET, createSessionToken(SECRET))).toBe(true);
  });

  it("lehnt Token mit falschem Schlüssel oder manipuliertem Inhalt ab", () => {
    const token = createSessionToken(SECRET);
    expect(verifySessionToken("b".repeat(40), token)).toBe(false);
    const [v, issued, nonce, mac] = token.split(".");
    expect(verifySessionToken(SECRET, `${v}.${Number(issued) + 1}.${nonce}.${mac}`)).toBe(false);
    expect(verifySessionToken(SECRET, undefined)).toBe(false);
    expect(verifySessionToken(SECRET, "unsinn")).toBe(false);
  });

  it("lehnt abgelaufene Token ab", () => {
    const now = Date.now();
    const token = createSessionToken(SECRET, now - SESSION_MAX_AGE_S * 1000 - 1);
    expect(verifySessionToken(SECRET, token, now)).toBe(false);
  });

  it("vergleicht Passwörter korrekt", () => {
    expect(constantTimeEqual("geheim", "geheim")).toBe(true);
    expect(constantTimeEqual("geheim", "geheim!")).toBe(false);
    expect(constantTimeEqual("", "x")).toBe(false);
  });
});
