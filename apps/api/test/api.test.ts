import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lookupRef } from "../src/modules/import/service.js";
import { resetDb, sampleBatch, setupTestDb, testClient } from "./helpers.js";

const { db, close } = setupTestDb();
const client = testClient(db);

beforeAll(async () => {
  await resetDb(db);
  const res = await client.post("/api/v1/import", sampleBatch());
  expect(res.status).toBe(200);
});
afterAll(() => close());

describe("Auth", () => {
  it("lehnt Anfragen ohne gültiges Token ab", async () => {
    const res = await client.get("/api/v1/contacts", "falsch");
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "unauthorized" });
  });

  it("lässt /health und /openapi.json offen", async () => {
    const health = await client.app.request("/health");
    expect(health.status).toBe(200);
    const spec = await client.app.request("/openapi.json");
    expect(spec.status).toBe(200);
    const json = (await spec.json()) as {
      paths: Record<string, unknown>;
      info: { license: { name: string } };
    };
    expect(json.info.license.name).toBe("AGPL-3.0-only");
    expect(Object.keys(json.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/contacts",
        "/api/v1/objects/{id}",
        "/api/v1/cases",
        "/api/v1/import",
      ]),
    );
  });
});

describe("Lesen", () => {
  it("sucht Kontakte", async () => {
    const res = await client.get("/api/v1/contacts?q=beispiel");
    expect(res.json.items.map((c: { displayName: string }) => c.displayName)).toEqual([
      "Gemeinde Beispielhausen",
    ]);
    expect(res.json.items[0].leitwegId).toBe("991-12345-67");
  });

  it("liefert Kontakt mit Kanälen", async () => {
    const id = await lookupRef(db, "testsystem", "contact", "k1");
    const res = await client.get(`/api/v1/contacts/${id}`);
    expect(res.status).toBe(200);
    expect(res.json.channels).toHaveLength(2);
  });

  it("liefert Objekt mit Beteiligten und allen Vorgängen", async () => {
    const id = await lookupRef(db, "testsystem", "object", "o1");
    const res = await client.get(`/api/v1/objects/${id}`);
    expect(res.status).toBe(200);
    expect(res.json.heatedAreaM2).toBe(142.5);
    expect(res.json.roles).toEqual([
      expect.objectContaining({ displayName: "Max Muster", role: "eigentuemer" }),
    ]);
    expect(res.json.cases.map((c: { number: string }) => c.number)).toEqual(["ISFP-001", "EM-002"]);
  });

  it("filtert Vorgänge nach Status und Leistungsart", async () => {
    const res = await client.get("/api/v1/cases?status=in_bearbeitung");
    expect(res.json.items.map((c: { number: string }) => c.number)).toEqual(["EM-002"]);
    const nwg = await client.get("/api/v1/cases?measureCode=NWG");
    expect(nwg.json.items).toHaveLength(1);
  });

  it("legt Leistungsarten beim Import an", async () => {
    const res = await client.get("/api/v1/measure-types");
    expect(res.json.items.map((m: { code: string }) => m.code)).toEqual(["EM", "ISFP", "NWG"]);
  });

  it("antwortet 404 und 400 sauber", async () => {
    expect((await client.get("/api/v1/cases/00000000-0000-4000-8000-000000000000")).status).toBe(
      404,
    );
    const bad = await client.get("/api/v1/cases/keine-uuid");
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("validation_failed");
  });
});
