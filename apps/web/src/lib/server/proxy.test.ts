import { describe, expect, it } from "vitest";
import { CLIENT_HEADER, checkCsrf, safeApiPath } from "./proxy";

describe("API-Proxy", () => {
  it("lässt nur einfache Pfade zu", () => {
    expect(safeApiPath("inspections/abc/items/def")).toBe("inspections/abc/items/def");
    expect(safeApiPath("../health")).toBeNull();
    expect(safeApiPath("a/%2e%2e/b")).toBeNull();
    expect(safeApiPath("a//b")).toBeNull();
    expect(safeApiPath("")).toBeNull();
  });

  it("verlangt Client-Header und gleiche Origin", () => {
    const origin = "https://akte.example.org";
    const req = (headers: Record<string, string>) =>
      new Request(`${origin}/api-proxy/x`, { method: "PUT", headers });
    expect(checkCsrf(req({ [CLIENT_HEADER]: "1", origin }), origin)).toBeNull();
    expect(checkCsrf(req({ origin }), origin)).not.toBeNull();
    expect(
      checkCsrf(req({ [CLIENT_HEADER]: "1", origin: "https://evil.example" }), origin),
    ).not.toBeNull();
    expect(
      checkCsrf(req({ [CLIENT_HEADER]: "1", "sec-fetch-site": "cross-site" }), origin),
    ).not.toBeNull();
    expect(checkCsrf(req({ [CLIENT_HEADER]: "1" }), origin)).toBeNull();
  });
});
