import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cases, contactChannels, events } from "../src/db/schema.js";
import { lookupRef } from "../src/modules/import/service.js";
import { resetDb, sampleBatch, setupTestDb, testClient } from "./helpers.js";

const { db, close } = setupTestDb();
const client = testClient(db);

beforeEach(() => resetDb(db));
afterAll(() => close());

const created = (n: number) => ({ created: n, updated: 0, unchanged: 0 });
const unchanged = (n: number) => ({ created: 0, updated: 0, unchanged: n });

describe("POST /api/v1/import", () => {
  it("importiert einen vollständigen Bestand", async () => {
    const res = await client.post("/api/v1/import", sampleBatch());
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      dryRun: false,
      contacts: created(2),
      objects: created(2),
      cases: created(3),
      communications: created(2),
      documents: created(1),
      billingDocuments: created(1),
    });

    const caseId = await lookupRef(db, "testsystem", "case", "p1");
    const detail = await client.get(`/api/v1/cases/${caseId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.customerName).toBe("Max Muster");
    expect(detail.json.billingDocuments).toEqual([
      expect.objectContaining({ number: "RE-2026-001", grossCents: 120000, status: "versendet" }),
    ]);
    expect(detail.json.documents).toHaveLength(1);
  });

  it("ist idempotent: zweiter Lauf ändert nichts", async () => {
    await client.post("/api/v1/import", sampleBatch());
    const eventsBefore = await db.select({ n: sql<number>`count(*)::int` }).from(events);

    const res = await client.post("/api/v1/import", sampleBatch());
    expect(res.status).toBe(200);
    expect(res.json.contacts).toEqual(unchanged(2));
    expect(res.json.objects).toEqual(unchanged(2));
    expect(res.json.cases).toEqual(unchanged(3));
    expect(res.json.communications).toEqual(unchanged(2));
    expect(res.json.billingDocuments).toEqual(unchanged(1));

    const eventsAfter = await db.select({ n: sql<number>`count(*)::int` }).from(events);
    expect(eventsAfter[0]?.n).toBe(eventsBefore[0]?.n);
  });

  it("aktualisiert geänderte Datensätze und protokolliert das", async () => {
    await client.post("/api/v1/import", sampleBatch());
    const batch = sampleBatch();
    batch.cases[1] = { ...batch.cases[1], status: "abrechnung" } as (typeof batch.cases)[number];
    batch.contacts[0] = {
      ...batch.contacts[0],
      channels: [{ kind: "email", value: "neu@example.org" }],
    } as (typeof batch.contacts)[number];

    const res = await client.post("/api/v1/import", batch);
    expect(res.json.cases).toEqual({ created: 0, updated: 1, unchanged: 2 });
    expect(res.json.contacts).toEqual({ created: 0, updated: 1, unchanged: 1 });

    const caseId = (await lookupRef(db, "testsystem", "case", "p2")) as string;
    const [row] = await db.select().from(cases).where(eq(cases.id, caseId));
    expect(row?.status).toBe("abrechnung");

    const contactId = (await lookupRef(db, "testsystem", "contact", "k1")) as string;
    const channels = await db
      .select()
      .from(contactChannels)
      .where(eq(contactChannels.contactId, contactId));
    expect(channels.map((c) => c.normalizedValue)).toEqual(["neu@example.org"]);

    const caseEvents = await db.select().from(events).where(eq(events.entityId, caseId));
    expect(caseEvents.map((e) => (e.payload as { action: string }).action)).toEqual([
      "created",
      "updated",
    ]);
  });

  it("normalisiert Kontaktkanäle für die spätere Zuordnung", async () => {
    await client.post("/api/v1/import", sampleBatch());
    const contactId = (await lookupRef(db, "testsystem", "contact", "k1")) as string;
    const channels = await db
      .select()
      .from(contactChannels)
      .where(eq(contactChannels.contactId, contactId));
    expect(channels.map((c) => c.normalizedValue).sort()).toEqual([
      "491701234567",
      "max.muster@example.org",
    ]);
  });

  it("dryRun zählt, speichert aber nichts", async () => {
    const res = await client.post("/api/v1/import", { ...sampleBatch(), dryRun: true });
    expect(res.status).toBe(200);
    expect(res.json.dryRun).toBe(true);
    expect(res.json.cases).toEqual(created(3));
    const list = await client.get("/api/v1/cases");
    expect(list.json.items).toEqual([]);
  });

  it("rollt bei unbekannten Referenzen komplett zurück", async () => {
    const batch = sampleBatch();
    batch.cases.push({
      externalId: "p9",
      number: "X-009",
      title: "Kaputt",
      customerExternalId: "gibt-es-nicht",
      status: "anfrage",
    } as (typeof batch.cases)[number]);

    const res = await client.post("/api/v1/import", batch);
    expect(res.status).toBe(422);
    expect(res.json.problems).toEqual([
      {
        path: "cases[p9].customerExternalId",
        message: 'unbekannte contact-Referenz "gibt-es-nicht"',
      },
    ]);
    const list = await client.get("/api/v1/contacts");
    expect(list.json.items).toEqual([]);
  });

  it("meldet doppelte externalIds und Eindeutigkeitsverletzungen", async () => {
    const dup = sampleBatch();
    dup.contacts.push({ ...dup.contacts[0] } as (typeof dup.contacts)[number]);
    const res1 = await client.post("/api/v1/import", dup);
    expect(res1.status).toBe(422);
    expect(res1.json.problems[0].message).toContain('"k1" kommt mehrfach vor');

    const sameNumber = sampleBatch();
    sameNumber.cases[1] = {
      ...sameNumber.cases[1],
      number: "ISFP-001",
    } as (typeof sameNumber.cases)[number];
    const res2 = await client.post("/api/v1/import", sameNumber);
    expect(res2.status).toBe(422);
    expect(res2.json.problems[0].message).toContain("Eindeutigkeitsverletzung");
  });

  it("prüft das Format (Beträge müssen aufgehen)", async () => {
    const batch = sampleBatch();
    batch.billingDocuments[0] = {
      ...batch.billingDocuments[0],
      grossCents: 1,
    } as (typeof batch.billingDocuments)[number];
    const res = await client.post("/api/v1/import", batch);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("validation_failed");
  });
});

describe("Ereignisprotokoll", () => {
  it("ist append-only", async () => {
    await client.post("/api/v1/import", sampleBatch());
    await expect(db.execute(sql`UPDATE events SET type = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM events`)).rejects.toThrow();
  });
});
