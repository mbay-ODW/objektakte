import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVorOrtDb, type VorOrtDb } from "./db";
import { backoffDelay, SyncQueue } from "./queue";
import type { JobPayload, SendOutcome } from "./types";

let db: VorOrtDb;
let dbName: string;
let counter = 0;

beforeEach(async () => {
  dbName = `test-queue-${++counter}`;
  db = await openVorOrtDb(dbName);
});

afterEach(() => {
  db.close();
  indexedDB.deleteDatabase(dbName);
});

const item = (inspectionId: string, itemId: string): JobPayload => ({
  type: "putItem",
  inspectionId,
  itemId,
  body: { category: "dach", label: itemId, attributes: {}, sortOrder: 0 },
});

/** Sender, der Aufrufe protokolliert und Ergebnisse aus einer Liste liefert. */
function scriptedSender(outcomes: SendOutcome[] = []) {
  const calls: JobPayload[] = [];
  const send = async (p: JobPayload): Promise<SendOutcome> => {
    calls.push(p);
    return outcomes.shift() ?? { ok: true };
  };
  return { calls, send };
}

describe("backoffDelay", () => {
  it("wächst exponentiell und ist gedeckelt", () => {
    expect(backoffDelay(0, 1000, 60_000)).toBe(0);
    expect(backoffDelay(1, 1000, 60_000)).toBe(1000);
    expect(backoffDelay(2, 1000, 60_000)).toBe(2000);
    expect(backoffDelay(5, 1000, 60_000)).toBe(16_000);
    expect(backoffDelay(20, 1000, 60_000)).toBe(60_000);
  });
});

describe("SyncQueue", () => {
  it("überträgt Aufträge in Einfügereihenfolge und leert die Warteschlange", async () => {
    const { calls, send } = scriptedSender();
    const q = new SyncQueue(db, send);
    await q.enqueue(item("b1", "a"));
    await q.enqueue(item("b2", "b"));
    await q.enqueue(item("b1", "c"));
    expect(await q.pendingCount()).toBe(3);
    expect(await q.pendingCount("b1")).toBe(2);

    const r = await q.flush();
    expect(r).toEqual({ sent: 3, remaining: 0, error: null });
    expect(calls.map((c) => (c.type === "putItem" ? c.itemId : ""))).toEqual(["a", "b", "c"]);
    expect(q.state.pending).toBe(0);
    expect(q.state.lastSyncAt).not.toBeNull();
  });

  it("bricht bei vorübergehenden Fehlern ab und wartet mit Backoff", async () => {
    let now = 1_000_000;
    const { calls, send } = scriptedSender([
      { ok: true },
      { ok: false, retry: true, error: "Keine Verbindung" },
    ]);
    const q = new SyncQueue(db, send, { now: () => now, baseDelayMs: 1000, maxDelayMs: 8000 });
    await q.enqueue(item("b1", "a"));
    await q.enqueue(item("b1", "b"));
    await q.enqueue(item("b1", "c"));

    const r1 = await q.flush();
    expect(r1).toEqual({ sent: 1, remaining: 2, error: "Keine Verbindung" });
    expect(q.state.lastError).toBe("Keine Verbindung");
    expect(q.state.nextAttemptAt).toBe(now + 1000);

    // Vor Ablauf der Wartezeit passiert nichts.
    const r2 = await q.flush();
    expect(r2.sent).toBe(0);
    expect(calls).toHaveLength(2);

    // Nach Ablauf wird wiederholt; ein weiterer Fehler verdoppelt die Wartezeit.
    now += 1000;
    const failing = new SyncQueue(db, async () => ({ ok: false, retry: true, error: "503" }), {
      now: () => now,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
    });
    await failing.flush();
    const [first] = await failing.jobs();
    expect(first?.attempts).toBe(2);
    expect(first?.nextAttemptAt).toBe(now + 2000);

    // Manuelles Synchronisieren ignoriert die Wartezeit und behält die Reihenfolge.
    const r3 = await q.flush({ force: true });
    expect(r3).toEqual({ sent: 2, remaining: 0, error: null });
    expect(calls.map((c) => (c.type === "putItem" ? c.itemId : ""))).toEqual(["a", "b", "b", "c"]);
  });

  it("wertet geworfene Fehler als vorübergehend", async () => {
    const q = new SyncQueue(db, async () => {
      throw new TypeError("Failed to fetch");
    });
    await q.enqueue(item("b1", "a"));
    const r = await q.flush();
    expect(r).toEqual({ sent: 0, remaining: 1, error: "Failed to fetch" });
    const [job] = await q.jobs();
    expect(job?.failed).toBe(false);
    expect(job?.attempts).toBe(1);
  });

  it("blockiert nach dauerhaftem Fehler nur die betroffene Begehung", async () => {
    const { calls, send } = scriptedSender([
      { ok: false, retry: false, error: "Validierung fehlgeschlagen" },
    ]);
    const q = new SyncQueue(db, send);
    await q.enqueue(item("b1", "a"));
    await q.enqueue(item("b1", "b"));
    await q.enqueue(item("b2", "x"));

    const r = await q.flush();
    expect(r.sent).toBe(1);
    expect(r.remaining).toBe(2);
    expect(r.error).toBe("Validierung fehlgeschlagen");
    expect(calls.map((c) => (c.type === "putItem" ? c.itemId : ""))).toEqual(["a", "x"]);
    expect(q.state.failed).toBe(1);

    // Weitere Durchläufe senden den fehlerhaften Auftrag nicht erneut.
    await q.flush({ force: true });
    expect(calls).toHaveLength(2);

    // Verwerfen gibt die Begehung wieder frei.
    const [failed] = (await q.jobs()).filter((j) => j.failed);
    await q.discard(failed?.seq as number);
    const r2 = await q.flush();
    expect(r2).toEqual({ sent: 1, remaining: 0, error: null });
    expect(calls.map((c) => (c.type === "putItem" ? c.itemId : ""))).toEqual(["a", "x", "b"]);
  });

  it("kann fehlgeschlagene Aufträge erneut versuchen", async () => {
    const { send } = scriptedSender([{ ok: false, retry: false, error: "422" }]);
    const q = new SyncQueue(db, send);
    await q.enqueue(item("b1", "a"));
    await q.flush();
    expect(q.state.failed).toBe(1);
    await q.retryFailed();
    expect(q.state.failed).toBe(0);
    expect(await q.flush()).toEqual({ sent: 1, remaining: 0, error: null });
  });

  it("überlebt einen Neustart (Aufträge liegen in IndexedDB)", async () => {
    const q1 = new SyncQueue(db, async () => ({ ok: false, retry: true, error: "offline" }));
    await q1.enqueue(item("b1", "a"));
    await q1.flush();
    db.close();

    db = await openVorOrtDb(dbName);
    const { calls, send } = scriptedSender();
    const q2 = new SyncQueue(db, send);
    await q2.refresh();
    expect(q2.state.pending).toBe(1);
    await q2.flush({ force: true });
    expect(calls).toHaveLength(1);
  });

  it("speichert Blobs der Medienaufträge", async () => {
    const q = new SyncQueue(db, async () => ({ ok: true }));
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    await q.enqueue({
      type: "putMedia",
      inspectionId: "b1",
      mediaId: "m1",
      meta: { kind: "foto", itemId: null, caption: null, takenAt: "2026-01-01T00:00:00Z" },
      blob,
      filename: "foto-m1.jpg",
    });
    const [job] = await q.jobs();
    expect(job?.payload.type).toBe("putMedia");
    const stored = job?.payload.type === "putMedia" ? job.payload.blob : null;
    expect(stored?.size).toBe(3);
    expect(stored?.type).toBe("image/jpeg");
  });

  it("teilt parallele Durchläufe und ruft onDone auf", async () => {
    const done: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const q = new SyncQueue(
      db,
      async () => {
        await gate;
        return { ok: true, result: "ok" };
      },
      { onDone: (p) => void done.push(p.type) },
    );
    await q.enqueue(item("b1", "a"));
    const a = q.flush();
    const b = q.flush();
    expect(a).toBe(b);
    release();
    expect((await a).sent).toBe(1);
    expect(done).toEqual(["putItem"]);
  });
});
