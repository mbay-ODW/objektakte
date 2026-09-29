import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { processTranscriptions } from "../src/modules/inspections/service.js";
import { resetDb, setupTestDb, TOKEN, testClient, testServices } from "./helpers.js";

const { db, close } = setupTestDb();
const services = testServices();
const client = testClient(db, services);

beforeEach(() => resetDb(db));
afterAll(() => close());

async function objectAndCase() {
  const k = await client.post("/api/v1/contacts", { kind: "person", lastName: "Muster" });
  const o = await client.post("/api/v1/objects", {
    label: "Grundschule Beispielhausen",
    usage: "nichtwohngebaeude",
    street: "Schulweg 1",
    city: "Beispielhausen",
  });
  const c = await client.post("/api/v1/cases", {
    number: "NWG-1",
    title: "Beratung",
    customerId: k.json.id,
    objectId: o.json.id,
  });
  return { objectId: o.json.id as string, caseId: c.json.id as string };
}

async function upload(
  inspectionId: string,
  mediaId: string,
  fields: Record<string, string>,
  file: File,
) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", file);
  const res = await client.app.request(`/api/v1/inspections/${inspectionId}/media/${mediaId}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  });
  return { status: res.status, json: await res.json() };
}

describe("Begehung", () => {
  it("erfasst offline erzeugte Daten idempotent, transkribiert und schließt ab", async () => {
    const { objectId, caseId } = await objectAndCase();
    const id = randomUUID();
    const body = {
      objectId,
      caseId,
      title: "Erstbegehung",
      startedAt: "2026-09-29T09:00:00+02:00",
      participants: [{ name: "Hausmeister Schmidt", role: "Hausmeister" }],
      weather: "bewölkt, 12 °C",
    };
    // doppelt gesendet (Offline-Warteschlange) → kein Fehler, kein Duplikat
    expect((await client.put(`/api/v1/inspections/${id}`, body)).status).toBe(200);
    expect((await client.put(`/api/v1/inspections/${id}`, body)).status).toBe(200);

    const itemId = randomUUID();
    const item = await client.put(`/api/v1/inspections/${id}/items/${itemId}`, {
      category: "beleuchtung",
      label: "Klassenräume EG",
      location: "Zone Unterricht",
      attributes: { leuchtmittel: "T8 Leuchtstoff", anzahl: 48 },
      condition: "mittel",
    });
    expect(item.status).toBe(200);
    expect(item.json.attributes).toEqual({ leuchtmittel: "T8 Leuchtstoff", anzahl: 48 });

    const photoId = randomUUID();
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "foto.jpg", {
      type: "image/jpeg",
    });
    const up1 = await upload(
      id,
      photoId,
      { kind: "foto", itemId, caption: "Leuchte Raum 1" },
      photo,
    );
    expect(up1).toEqual({ status: 200, json: { id: photoId, duplicate: false } });
    const up2 = await upload(id, photoId, { kind: "foto", itemId }, photo);
    expect(up2.json.duplicate).toBe(true);

    const audioId = randomUUID();
    const audio = new File([new Uint8Array(1234)], "notiz.webm", { type: "audio/webm" });
    await upload(id, audioId, { kind: "audio", itemId }, audio);

    let detail = await client.get(`/api/v1/inspections/${id}`);
    expect(detail.json.media).toHaveLength(2);
    expect(detail.json.media.find((m: { id: string }) => m.id === audioId).transcriptStatus).toBe(
      "ausstehend",
    );

    expect(await processTranscriptions(db, services)).toEqual({ processed: 1 });
    detail = await client.get(`/api/v1/inspections/${id}`);
    expect(detail.json.media.find((m: { id: string }) => m.id === audioId)).toMatchObject({
      transcriptStatus: "fertig",
      transcript: "Transkript (1234 Bytes)",
    });

    // Datei ist abrufbar
    const docId = detail.json.media.find((m: { id: string }) => m.id === photoId).documentId;
    const file = await client.app.request(`/api/v1/documents/${docId}/file`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(file.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await file.arrayBuffer()).length).toBe(7);

    const fin = await client.post(`/api/v1/inspections/${id}/finalize`, {
      endedAt: "2026-09-29T11:30:00+02:00",
    });
    expect(fin.status).toBe(200);
    expect(fin.json.inspection).toMatchObject({ status: "abgeschlossen" });
    expect(fin.json.inspection.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fin.json.protocol).toMatchObject({ mimeType: "application/pdf", warning: null });

    // Chronik des Vorgangs enthält die Begehung
    const tl = await client.get(`/api/v1/timeline?caseId=${caseId}`);
    expect(
      tl.json.items.some((i: { title: string }) => i.title.includes("Begehung: Erstbegehung")),
    ).toBe(true);
    const kase = await client.get(`/api/v1/cases/${caseId}`);
    expect(kase.json.documents.map((d: { docClass: string }) => d.docClass).sort()).toEqual([
      "begehungsprotokoll",
      "foto",
      "sprachnotiz",
    ]);
  });

  it("ist nach Abschluss unveränderlich – auch direkt in der Datenbank", async () => {
    const { objectId } = await objectAndCase();
    const id = randomUUID();
    await client.put(`/api/v1/inspections/${id}`, {
      objectId,
      title: "Kurz",
      startedAt: "2026-09-29T09:00:00+02:00",
    });
    await client.put(`/api/v1/inspections/${id}/items/${randomUUID()}`, {
      category: "dach",
      label: "Steildach",
    });
    await client.post(`/api/v1/inspections/${id}/finalize`, {});

    const change = await client.put(`/api/v1/inspections/${id}/items/${randomUUID()}`, {
      category: "dach",
      label: "neu",
    });
    expect(change.status).toBe(409);
    await expect(db.execute(sql`UPDATE inspection_items SET label = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE inspections SET title = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM inspections`)).rejects.toThrow();
  });

  it("legt ohne PDF-Renderer ein HTML-Protokoll ab und escaped Eingaben", async () => {
    const plain = testClient(db, testServices({ pdf: undefined }));
    const { objectId } = await objectAndCase();
    const id = randomUUID();
    await plain.put(`/api/v1/inspections/${id}`, {
      objectId,
      title: "<script>alert(1)</script>",
      startedAt: "2026-09-29T09:00:00+02:00",
    });
    const fin = await plain.post(`/api/v1/inspections/${id}/finalize`, {});
    expect(fin.json.protocol).toMatchObject({ mimeType: "text/html" });
    expect(fin.json.protocol.warning).toContain("Kein PDF-Renderer");
    const res = await plain.app.request(`/api/v1/documents/${fin.json.protocol.documentId}/file`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const html = await res.text();
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("prüft Dateityp und markiert fehlgeschlagene Transkriptionen", async () => {
    const failing = testServices({
      storage: services.storage,
      transcriber: {
        transcribe: async () => {
          throw new Error("Dienst nicht erreichbar");
        },
      },
    });
    const c2 = testClient(db, failing);
    const { objectId } = await objectAndCase();
    const id = randomUUID();
    await c2.put(`/api/v1/inspections/${id}`, {
      objectId,
      title: "T",
      startedAt: "2026-09-29T09:00:00+02:00",
    });
    const wrong = await upload(
      id,
      randomUUID(),
      { kind: "foto" },
      new File(["x"], "a.txt", { type: "text/plain" }),
    );
    expect(wrong.status).toBe(422);

    const audioId = randomUUID();
    await upload(
      id,
      audioId,
      { kind: "audio" },
      new File([new Uint8Array(10)], "a.webm", { type: "audio/webm" }),
    );
    for (let i = 0; i < 3; i++) await processTranscriptions(db, failing);
    const d = await c2.get(`/api/v1/inspections/${id}`);
    expect(d.json.media[0]).toMatchObject({
      transcriptStatus: "fehler",
      transcriptError: "Dienst nicht erreichbar",
    });
    expect((await c2.post(`/api/v1/inspection-media/${audioId}/transcribe`, {})).status).toBe(202);
  });

  it("bietet Datei-Uploads nicht als MCP-Tool an", async () => {
    const spec = await (await client.app.request("/openapi.json")).json();
    expect(spec.paths["/api/v1/inspections/{id}/media/{mediaId}"].put["x-mcp"]).toBe(false);
  });
});
