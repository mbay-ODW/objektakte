import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVorOrtDb, type VorOrtDb } from "./db";
import { createFetchSender } from "./sender";
import { type ServerInspection, VorOrtService } from "./service";
import type { JobPayload, SendOutcome } from "./types";

let db: VorOrtDb;
let dbName: string;
let counter = 0;
let ids = 0;

beforeEach(async () => {
  dbName = `test-service-${++counter}`;
  db = await openVorOrtDb(dbName);
  ids = 0;
});

afterEach(() => {
  db.close();
  indexedDB.deleteDatabase(dbName);
});

function setup(outcome: (p: JobPayload) => SendOutcome = () => ({ ok: true })) {
  const sent: JobPayload[] = [];
  const service = new VorOrtService(
    db,
    async (p) => {
      sent.push(p);
      return outcome(p);
    },
    {
      newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
      now: () => new Date("2026-06-01T10:00:00Z"),
    },
  );
  return { service, sent };
}

const start = {
  objectId: "11111111-1111-4111-8111-111111111111",
  objectLabel: "EFH Musterweg 1",
  caseId: null,
  title: "Begehung",
  participants: [{ name: "Max Muster", role: "Eigentümer" }],
  weather: "sonnig",
  notes: null,
};

describe("VorOrtService", () => {
  it("speichert lokal und reiht idempotente Aufträge ein", async () => {
    const { service } = setup();
    const b = await service.start(start);
    const item = await service.saveItem(b.id, {
      category: "fenster",
      label: "Fenster EG",
      location: "Wohnzimmer",
      condition: "mittel",
      attributes: { material: "Holz" },
      notes: null,
    });
    await service.saveItem(b.id, { ...item, label: "Fenster EG links" });
    await service.addMedia(b.id, new Blob([new Uint8Array(10)], { type: "image/jpeg" }), {
      kind: "foto",
      itemId: item.id,
      caption: null,
    });

    const local = await service.inspection(b.id);
    expect(local?.items).toHaveLength(1);
    expect(local?.items[0]?.label).toBe("Fenster EG links");
    expect(local?.media).toHaveLength(1);
    expect(await service.mediaBlob(local?.media[0]?.id as string)).not.toBeNull();

    const jobs = await service.queue.jobs();
    expect(jobs.map((j) => j.payload.type)).toEqual([
      "putInspection",
      "putItem",
      "putItem",
      "putMedia",
    ]);
    expect(await service.queue.pendingCount(b.id)).toBe(4);
  });

  it("erlaubt den Abschluss erst nach vollständiger Synchronisation", async () => {
    const { service, sent } = setup((p) =>
      p.type === "finalize"
        ? {
            ok: true,
            result: {
              inspection: serverDetail(p.inspectionId, { status: "abgeschlossen" }),
              protocol: { documentId: "p1", mimeType: "text/html", warning: null },
            },
          }
        : { ok: true },
    );
    const b = await service.start(start);
    expect(await service.canFinalize(b.id)).toBe(false);
    await expect(service.finalize(b.id)).rejects.toThrow(/synchronisieren/);

    await service.queue.flush();
    expect(await service.canFinalize(b.id)).toBe(true);
    await service.finalize(b.id);

    expect(sent.map((p) => p.type)).toEqual(["putInspection", "finalize"]);
    const local = await service.inspection(b.id);
    expect(local?.status).toBe("abgeschlossen");
    expect(local?.protocolDocumentId).toBe("22222222-2222-4222-8222-222222222222");
    await expect(service.saveItem(b.id, item())).rejects.toThrow(/abgeschlossen/);
  });

  it("entfernt lokale Blobs nach erfolgreichem Upload", async () => {
    const { service } = setup();
    const b = await service.start(start);
    const m = await service.addMedia(b.id, new Blob(["x"], { type: "audio/webm;codecs=opus" }), {
      kind: "audio",
      itemId: null,
      caption: null,
    });
    expect(m.mimeType).toBe("audio/webm");
    const [, mediaJob] = await service.queue.jobs();
    expect(mediaJob?.payload.type === "putMedia" && mediaJob.payload.filename).toBe(
      `audio-${m.id}.webm`,
    );
    await service.queue.flush();
    expect(await service.mediaBlob(m.id)).toBeNull();
  });

  it("übernimmt Transkripte und Dokument-IDs vom Server", async () => {
    const { service } = setup();
    const b = await service.start(start);
    const m = await service.addMedia(b.id, new Blob(["x"], { type: "audio/webm" }), {
      kind: "audio",
      itemId: null,
      caption: null,
    });
    await service.queue.flush();
    const server = serverDetail(b.id, {
      media: [
        {
          id: m.id,
          itemId: null,
          kind: "audio",
          documentId: "33333333-3333-4333-8333-333333333333",
          mimeType: "audio/webm",
          caption: null,
          takenAt: m.takenAt,
          transcriptStatus: "fertig",
          transcript: "Dach undicht",
          transcriptError: null,
        },
      ],
    });
    const merged = await service.mergeServer(server);
    expect(merged.media[0]?.transcript).toBe("Dach undicht");
    expect(merged.media[0]?.documentId).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("importiert unbekannte Begehungen vom Server", async () => {
    const { service } = setup();
    const merged = await service.mergeServer(
      serverDetail("44444444-4444-4444-8444-444444444444"),
      "Objekt",
    );
    expect(merged.objectLabel).toBe("Objekt");
    expect((await service.inspections()).map((i) => i.id)).toContain(merged.id);
  });

  it("puffert Objekte für die Offline-Auswahl", async () => {
    const { service } = setup();
    await service.cacheObjects([
      { id: "o2", label: "Schule", street: null, postalCode: null, city: null, cases: [] },
      { id: "o1", label: "EFH", street: null, postalCode: null, city: null, cases: [] },
    ]);
    expect((await service.objects()).map((o) => o.label)).toEqual(["EFH", "Schule"]);
    expect(await service.objectsCachedAt()).toBe("2026-06-01T10:00:00.000Z");
  });
});

describe("createFetchSender", () => {
  const payload: JobPayload = {
    type: "putItem",
    inspectionId: "b1",
    itemId: "i1",
    body: { category: "dach", label: "Dach", attributes: {}, sortOrder: 0 },
  };

  it("sendet mit Client-Header an den Proxy und bewertet Statuscodes", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const respond = (status: number, body: unknown = {}) =>
      createFetchSender(async (url, init) => {
        seen.push({ url, init });
        return new Response(status === 204 ? null : JSON.stringify(body), { status });
      });
    expect(await respond(200)(payload)).toEqual({ ok: true, result: {} });
    expect(seen[0]?.url).toBe("/api-proxy/inspections/b1/items/i1");
    expect(new Headers(seen[0]?.init?.headers).get("x-objektakte-client")).toBe("1");
    expect(await respond(503)(payload)).toMatchObject({ ok: false, retry: true });
    expect(await respond(401)(payload)).toMatchObject({ ok: false, retry: true });
    expect(await respond(422, { message: "Objekt nicht gefunden" })(payload)).toEqual({
      ok: false,
      retry: false,
      error: "Objekt nicht gefunden (422)",
    });
    const finalize: JobPayload = { type: "finalize", inspectionId: "b1", endedAt: "x" };
    expect(await respond(409)(finalize)).toEqual({ ok: true, result: null });
  });

  it("meldet Netzfehler als wiederholbar", async () => {
    const send = createFetchSender(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await send(payload)).toMatchObject({ ok: false, retry: true });
  });

  it("überträgt Medien als multipart", async () => {
    let body: unknown;
    const send = createFetchSender(async (_url, init) => {
      body = init?.body;
      return new Response("{}", { status: 200 });
    });
    await send({
      type: "putMedia",
      inspectionId: "b1",
      mediaId: "m1",
      meta: { kind: "foto", itemId: "i1", caption: "Nordseite", takenAt: "2026-01-01T00:00:00Z" },
      blob: new Blob(["x"], { type: "image/jpeg" }),
      filename: "foto-m1.jpg",
    });
    const form = body as FormData;
    expect(form.get("kind")).toBe("foto");
    expect(form.get("itemId")).toBe("i1");
    expect((form.get("file") as File).name).toBe("foto-m1.jpg");
  });
});

function item() {
  return {
    category: "dach" as const,
    label: "Dach",
    location: null,
    condition: null,
    attributes: {},
    notes: null,
  };
}

function serverDetail(id: string, overrides: Partial<ServerInspection> = {}): ServerInspection {
  return {
    id,
    objectId: start.objectId,
    caseId: null,
    title: "Begehung",
    status: "laufend",
    startedAt: "2026-06-01T10:00:00.000Z",
    participants: [],
    weather: null,
    notes: null,
    finalizedAt: overrides.status === "abgeschlossen" ? "2026-06-01T11:00:00.000Z" : null,
    protocolDocumentId:
      overrides.status === "abgeschlossen" ? "22222222-2222-4222-8222-222222222222" : null,
    items: [],
    media: [],
    ...overrides,
  };
}
