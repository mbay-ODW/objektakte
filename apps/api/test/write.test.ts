import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, setupTestDb, testClient } from "./helpers.js";

const { db, close } = setupTestDb();
const client = testClient(db);

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("Kontakte, Objekte, Vorgänge schreiben", () => {
  it("legt einen Fall vollständig an und protokolliert Änderungen", async () => {
    const org = await client.post("/api/v1/contacts", {
      kind: "organisation",
      organisationName: "Hausverwaltung Muster GmbH",
      channels: [{ kind: "phone", value: "06061 12345" }],
    });
    expect(org.status).toBe(201);
    expect(org.json.displayName).toBe("Hausverwaltung Muster GmbH");

    const obj = await client.post("/api/v1/objects", {
      label: "MFH Beispielstraße 3",
      usage: "wohngebaeude",
      units: 6,
      heatedAreaM2: 480,
      roles: [{ contactId: org.json.id, role: "verwaltung" }],
    });
    expect(obj.status).toBe(201);
    expect(obj.json.roles).toEqual([
      expect.objectContaining({ displayName: "Hausverwaltung Muster GmbH", role: "verwaltung" }),
    ]);

    await client.put("/api/v1/measure-types/ISFP", { name: "iSFP" });
    await client.put("/api/v1/number-sequences/case", { nextValue: 330 });
    const kase = await client.post("/api/v1/cases", {
      title: "iSFP MFH",
      customerId: org.json.id,
      objectId: obj.json.id,
      measureCode: "ISFP",
    });
    expect(kase.status).toBe(201);
    expect(kase.json.number).toBe("ISFP-330");
    const second = await client.post("/api/v1/cases", {
      title: "Zweiter",
      customerId: org.json.id,
      measureCode: "ISFP",
    });
    expect(second.json.number).toBe("ISFP-331");

    const patched = await client.patch(`/api/v1/cases/${kase.json.id}`, { status: "beauftragt" });
    expect(patched.json.status).toBe("beauftragt");
    expect(patched.json.statusOverridden).toBe(true);

    const ev = await client.get(`/api/v1/events?entityId=${kase.json.id}`);
    expect(ev.json.items.map((e: { type: string }) => e.type)).toEqual([
      "case.created",
      "case.updated",
      "case.status_changed",
    ]);
    expect(ev.json.items[1].payload.changes.status).toEqual({ from: "anfrage", to: "beauftragt" });

    const objDetail = await client.get(`/api/v1/objects/${obj.json.id}`);
    expect(objDetail.json.cases.map((c: { number: string }) => c.number)).toEqual(["ISFP-330"]);
  });

  it("ersetzt Kanäle und prüft Pflichtangaben", async () => {
    const c = await client.post("/api/v1/contacts", { kind: "person", lastName: "Muster" });
    const p = await client.patch(`/api/v1/contacts/${c.json.id}`, {
      city: "Musterstadt",
      channels: [{ kind: "email", value: "a@example.org" }],
    });
    expect(p.json.city).toBe("Musterstadt");
    expect(p.json.channels).toHaveLength(1);

    const empty = await client.post("/api/v1/contacts", { kind: "person" });
    expect(empty.status).toBe(422);
    const missing = await client.patch("/api/v1/contacts/00000000-0000-4000-8000-000000000000", {
      city: "X",
    });
    expect(missing.status).toBe(404);
  });

  it("verhindert doppelte Vorgangsnummern und unbekannte Leistungsarten", async () => {
    const c = await client.post("/api/v1/contacts", { kind: "person", lastName: "Muster" });
    await client.post("/api/v1/cases", { number: "X-1", title: "A", customerId: c.json.id });
    const dup = await client.post("/api/v1/cases", {
      number: "X-1",
      title: "B",
      customerId: c.json.id,
    });
    expect(dup.status).toBe(409);
    const bad = await client.post("/api/v1/cases", {
      title: "C",
      customerId: c.json.id,
      measureCode: "NOPE",
    });
    expect(bad.status).toBe(422);
  });

  it("setzt Nummernkreise nicht zurück", async () => {
    await client.put("/api/v1/number-sequences/case", { nextValue: 100 });
    const back = await client.put("/api/v1/number-sequences/case", { nextValue: 50 });
    expect(back.status).toBe(409);
    const list = await client.get("/api/v1/number-sequences");
    expect(list.json.items).toEqual([{ key: "case", nextValue: 100, padding: 0 }]);
  });

  it("vergibt Nummern unter Parallelität lückenlos und eindeutig", async () => {
    const c = await client.post("/api/v1/contacts", { kind: "person", lastName: "Muster" });
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        client.post("/api/v1/cases", { title: `Parallel ${i}`, customerId: c.json.id }),
      ),
    );
    const numbers = results
      .map((r) => Number(String(r.json.number).split("-")[1]))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
});
