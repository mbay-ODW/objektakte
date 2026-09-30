import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", API_TOKEN: "12345678" };

describe("loadEnv", () => {
  it("behandelt leere Werte wie nicht gesetzt", () => {
    const env = loadEnv({ ...base, WHISPER_URL: "", NEXTCLOUD_URL: "", EINVOICE_VALIDATION: "" });
    expect(env.WHISPER_URL).toBeUndefined();
    expect(env.NEXTCLOUD_URL).toBeUndefined();
    expect(env.EINVOICE_VALIDATION).toBe("required");
  });

  it("lehnt ungültige URLs weiterhin ab", () => {
    expect(() => loadEnv({ ...base, WHISPER_URL: "kein-url" })).toThrow();
  });
});
