import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dispatchWebhooks, matchesType } from "../src/modules/webhooks/dispatcher.js";
import { resetDb, setupTestDb, testClient } from "./helpers.js";

const { db, close } = setupTestDb();
const client = testClient(db);

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("matchesType", () => {
  it("kennt Platzhalter", () => {
    expect(matchesType("case.created", ["*"])).toBe(true);
    expect(matchesType("case.created", ["case.*"])).toBe(true);
    expect(matchesType("casefile.created", ["case.*"])).toBe(false);
    expect(matchesType("deadline.created", ["case.*", "deadline.created"])).toBe(true);
  });
});

describe("Webhook-Zustellung", () => {
  it("stellt passende Ereignisse signiert zu und setzt den Cursor", async () => {
    const hook = await client.post("/api/v1/webhooks", {
      url: "https://n8n.example.org/webhook/objektakte",
      eventTypes: ["contact.*"],
    });
    expect(hook.status).toBe(201);
    expect(hook.json.secret).toHaveLength(64);

    await client.post("/api/v1/contacts", { kind: "person", lastName: "Muster" });
    await client.put("/api/v1/measure-types/EM", { name: "EM" });

    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const fakeFetch = async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), headers: init.headers as Record<string, string> });
      return new Response(null, { status: 204 });
    };
    const res = await dispatchWebhooks(db, { fetch: fakeFetch });
    expect(res).toEqual([{ subscriptionId: hook.json.id, delivered: 1 }]);
    const payload = JSON.parse(calls[0]!.body);
    expect(payload.events.map((e: { type: string }) => e.type)).toEqual(["contact.created"]);
    const expected = `sha256=${createHmac("sha256", hook.json.secret).update(calls[0]!.body).digest("hex")}`;
    expect(calls[0]!.headers["x-objektakte-signature"]).toBe(expected);

    // zweiter Lauf: nichts Neues
    expect(await dispatchWebhooks(db, { fetch: fakeFetch })).toEqual([]);
  });

  it("wiederholt nach Fehlern mit Backoff", async () => {
    const hook = await client.post("/api/v1/webhooks", { url: "https://n8n.example.org/x" });
    await client.post("/api/v1/contacts", { kind: "person", lastName: "Muster" });
    const failing = async () => new Response("kaputt", { status: 500 });
    const now = new Date("2026-09-29T10:00:00Z");
    expect(await dispatchWebhooks(db, { fetch: failing, now })).toEqual([
      { subscriptionId: hook.json.id, delivered: 0, error: "HTTP 500" },
    ]);
    // innerhalb des Backoffs kein erneuter Versuch
    expect(
      await dispatchWebhooks(db, { fetch: failing, now: new Date(now.getTime() + 1000) }),
    ).toEqual([]);
    const ok = async () => new Response(null, { status: 200 });
    const later = new Date(now.getTime() + 60_000);
    expect(await dispatchWebhooks(db, { fetch: ok, now: later })).toEqual([
      { subscriptionId: hook.json.id, delivered: 1 },
    ]);
    const list = await client.get("/api/v1/webhooks");
    expect(list.json.items[0]).toMatchObject({ failures: 0, lastError: null });
    expect(list.json.items[0].secret).toBeUndefined();
  });
});
