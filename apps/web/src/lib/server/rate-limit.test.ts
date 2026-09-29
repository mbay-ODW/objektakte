import { describe, expect, it } from "vitest";
import { LoginRateLimiter, waitMessage } from "./rate-limit";

describe("LoginRateLimiter", () => {
  it("sperrt nach 5 Fehlversuchen für den Rest des Fensters", () => {
    let now = 0;
    const l = new LoginRateLimiter({ now: () => now });
    for (let i = 0; i < 4; i++) l.fail("1.2.3.4");
    expect(l.retryAfter("1.2.3.4")).toBe(0);
    l.fail("1.2.3.4");
    expect(l.retryAfter("1.2.3.4")).toBe(15 * 60);
    now += 10 * 60_000;
    expect(l.retryAfter("1.2.3.4")).toBe(5 * 60);
    now += 5 * 60_000;
    expect(l.retryAfter("1.2.3.4")).toBe(0);
  });

  it("zählt Clients getrennt und setzt nach Erfolg zurück", () => {
    const l = new LoginRateLimiter({ max: 2 });
    l.fail("a");
    l.fail("a");
    expect(l.retryAfter("a")).toBeGreaterThan(0);
    expect(l.retryAfter("b")).toBe(0);
    l.reset("a");
    expect(l.retryAfter("a")).toBe(0);
  });

  it("begrenzt die Zahl gemerkter Clients", () => {
    const l = new LoginRateLimiter({ max: 1, maxEntries: 3 });
    for (const k of ["a", "b", "c", "d"]) l.fail(k);
    expect(l.retryAfter("a")).toBe(0);
    expect(l.retryAfter("d")).toBeGreaterThan(0);
  });

  it("formuliert die Wartezeit", () => {
    expect(waitMessage(30)).toBe("Zu viele Fehlversuche. Bitte in 1 Minute erneut versuchen.");
    expect(waitMessage(600)).toContain("10 Minuten");
  });
});
