/**
 * Regressionstests zu Befunden aus dem Code-Review (Geld, Nebenläufigkeit, Sicherheit, GoBD).
 */
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { PDFDocument, PDFName } from "pdf-lib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { events } from "../src/db/schema.js";
import { todayIso } from "../src/lib/dates.js";
import { recordEvents } from "../src/lib/events.js";
import { extractXmlFromPdf } from "../src/modules/billing/incoming.js";
import { fiscalYearStart } from "../src/modules/reports/service.js";
import { resetDb, setupTestDb, TOKEN, testClient, testServices } from "./helpers.js";

const { db, close } = setupTestDb();
const services = testServices();
const client = testClient(db, services);
const auth = { headers: { authorization: `Bearer ${TOKEN}` } };

const company = {
  name: "Energieberatung Muster",
  street: "Musterweg 1",
  postalCode: "12345",
  city: "Musterstadt",
  vatId: "DE123456789",
  email: "rechnung@beratung.example",
  phone: "+49 6061 99999",
  contactName: "Max Muster",
  iban: "DE02120300000000202051",
};

let personId: string;
let caseId: string;

beforeEach(async () => {
  await resetDb(db);
  await client.put("/api/v1/settings/company", company);
  personId = (
    await client.post("/api/v1/contacts", {
      kind: "person",
      firstName: "Erika",
      lastName: "Beispiel",
      city: "Musterstadt",
      postalCode: "12345",
    })
  ).json.id;
  caseId = (
    await client.post("/api/v1/cases", { number: "EM-1", title: "Sanierung", customerId: personId })
  ).json.id;
});
afterAll(() => close());

async function invoice(type: string, cents: number, extra: Record<string, unknown> = {}) {
  const d = await client.post("/api/v1/billing-documents", {
    type,
    contactId: personId,
    caseId,
    lines: [{ name: type, quantity: 1, unitCode: "LS", unitPriceCents: cents }],
    ...extra,
  });
  expect(d.status).toBe(201);
  const f = await client.post(`/api/v1/billing-documents/${d.json.id}/finalize`, {});
  expect(f.status).toBe(200);
  return f.json;
}

async function pay(amount: string, purpose: string, account = "K1", name = "Erika Beispiel") {
  const csv = `Buchungstag;Betrag;Verwendungszweck;Name Zahlungsbeteiligter\n15.09.2026;${amount};${purpose};${name}\n`;
  const res = await client.app.request(`/api/v1/bank/transactions/import-csv?account=${account}`, {
    method: "POST",
    headers: { ...auth.headers, "content-type": "text/csv" },
    body: csv,
  });
  return res.json();
}

describe("Schlussrechnung mit Abschlägen (#1)", { timeout: 60_000 }, () => {
  it("führt Forderung, Status, Umsatz und Storno mit dem Betrag nach Abzug", async () => {
    const a = await invoice("abschlagsrechnung", 50000, { issueDate: "2026-09-01" }); // 595,00 brutto
    const s = await invoice("schlussrechnung", 100000, { issueDate: "2026-09-10" }); // 1190,00 brutto
    expect(s).toMatchObject({ grossCents: 119000, prepaidCents: 59500 });

    const pdf = new Uint8Array(
      await (
        await client.app.request(`/api/v1/documents/${s.pdfDocumentId}/file`, auth)
      ).arrayBuffer(),
    );
    const xml = await extractXmlFromPdf(pdf);
    // § 14 Abs. 5 UStG: abgesetzte Abschläge mit Entgelt und Steuer
    expect(xml).toContain(`Abzüglich Abschlagsrechnung ${a.number}`);
    expect(xml).toContain("Entgelt 500,00 €, Umsatzsteuer 95,00 €");

    let open = (await client.get("/api/v1/receivables")).json;
    expect(open.items.find((r: { number: string }) => r.number === s.number).openCents).toBe(59500);

    await pay("595,00", a.number);
    await pay("595,00", s.number);
    open = (await client.get("/api/v1/receivables")).json;
    expect(open.totalOpenCents).toBe(0);
    expect((await client.get(`/api/v1/cases/${caseId}`)).json.status).toBe("abgeschlossen");

    const soll = await client.get(
      "/api/v1/reports/revenue?from=2026-01-01&to=2026-12-31&basis=soll",
    );
    expect(soll.json.total).toMatchObject({
      netCents: 100000,
      taxCents: 19000,
      grossCents: 119000,
    });

    // Abschlag kann nicht mehr storniert werden, solange die Schlussrechnung gilt (#11)
    const cancelA = await client.post(`/api/v1/billing-documents/${a.id}/cancel`, {});
    expect(cancelA.status).toBe(409);

    // Storno der Schlussrechnung hebt nur den Restbetrag auf
    const c = await client.post(`/api/v1/billing-documents/${s.id}/cancel`, {});
    expect(c.json.storno).toMatchObject({ grossCents: 119000, prepaidCents: 59500 });
    const after = await client.get(
      "/api/v1/reports/revenue?from=2026-01-01&to=2026-12-31&basis=soll",
    );
    expect(after.json.total).toMatchObject({ netCents: 50000, grossCents: 59500 });
  });
});

describe("Nebenläufigkeit (#2, #4)", { timeout: 60_000 }, () => {
  it("storniert parallel nur einmal", async () => {
    const r = await invoice("rechnung", 10000);
    const results = await Promise.all([
      client.post(`/api/v1/billing-documents/${r.id}/cancel`, {}),
      client.post(`/api/v1/billing-documents/${r.id}/cancel`, {}),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const stornos = (await client.get("/api/v1/billing-documents?type=stornorechnung")).json.items;
    expect(stornos.filter((d: { status: string }) => d.status !== "entwurf")).toHaveLength(1);
  });

  it("überbucht eine Rechnung nicht durch parallele Zuordnungen", async () => {
    const r = await invoice("rechnung", 10000); // 119,00
    await pay("119,00", "ohne Bezug A", "K1", "Unbekannt");
    await pay("119,00", "ohne Bezug B", "K2", "Unbekannt");
    const txs = (await client.get("/api/v1/bank/transactions?status=offen")).json.items;
    expect(txs).toHaveLength(2);
    const results = await Promise.all(
      txs.map((t: { id: string }) =>
        client.post(`/api/v1/bank/transactions/${t.id}/allocate`, {
          allocations: [{ billingDocumentId: r.id, amountCents: 11900 }],
        }),
      ),
    );
    expect(results.map((x) => x.status).sort()).toEqual([200, 422]);
  });
});

describe("Zahlungen (#3, #5, #16)", () => {
  it("ordnet ähnliche Nummern nicht zu und lehnt Ausgänge ab", async () => {
    const r = await invoice("rechnung", 10000);
    const res = await pay("50,00", `${r.number}7`);
    expect(res.allocated).toBe(0);
    await pay("-119,00", "Lieferant");
    const out = (await client.get("/api/v1/bank/transactions")).json.items.find(
      (t: { amountCents: number }) => t.amountCents < 0,
    );
    const bad = await client.post(`/api/v1/bank/transactions/${out.id}/allocate`, {
      allocations: [{ billingDocumentId: r.id, amountCents: 11900 }],
    });
    expect(bad.status).toBe(422);
    expect((await client.get("/api/v1/receivables?overdueOnly=false")).json.items).toHaveLength(1);
  });
});

describe("Festschreiben (#7, #10, #12, #15)", { timeout: 60_000 }, () => {
  it("meldet einen ausgefallenen Validator mit 503 und verbraucht keine Nummer", async () => {
    const down = testClient(
      db,
      testServices({
        validator: {
          validate: async () => {
            throw new Error("ECONNREFUSED");
          },
        },
        eInvoiceValidation: "required",
      }),
    );
    const d = await down.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      lines: [{ name: "X", quantity: 1, unitCode: "LS", unitPriceCents: 100 }],
    });
    const f = await down.post(`/api/v1/billing-documents/${d.json.id}/finalize`, {});
    expect(f.status).toBe(503);
    expect((await client.get("/api/v1/number-sequences")).json.items).toEqual([]);
  });

  it("entfernt abgelegte Dateien, wenn das Festschreiben danach scheitert", async () => {
    const stored: string[] = [];
    const failingXml = testServices({
      storage: {
        kind: "local",
        put: async (path: string) => {
          if (path.endsWith(".xml")) throw new Error("Ablage voll");
          stored.push(path);
          return { storage: "local", location: path };
        },
        get: async () => new Uint8Array(),
        delete: async (location: string) => {
          stored.splice(stored.indexOf(location), 1);
        },
      },
    });
    const c2 = testClient(db, failingXml);
    const pub = await client.post("/api/v1/contacts", {
      kind: "organisation",
      organisationName: "Gemeinde X",
      city: "X",
      postalCode: "11111",
      leitwegId: "991-1-2",
      channels: [{ kind: "email", value: "r@x.example" }],
    });
    const d = await c2.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: pub.json.id,
      lines: [{ name: "X", quantity: 1, unitCode: "LS", unitPriceCents: 100 }],
    });
    const f = await c2.post(`/api/v1/billing-documents/${d.json.id}/finalize`, {});
    expect(f.status).toBe(500);
    expect(stored).toEqual([]);
    expect((await client.get(`/api/v1/billing-documents/${d.json.id}`)).json.status).toBe(
      "entwurf",
    );
  });

  it("wendet § 19 UStG auch nach nachträglichem Umschalten an", async () => {
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      lines: [{ name: "X", quantity: 1, unitCode: "LS", unitPriceCents: 10000 }],
    });
    expect(d.json.taxCents).toBe(1900);
    await client.put("/api/v1/settings/company", {
      ...company,
      vatId: null,
      taxNumber: "1/2/3",
      sellerId: "KU",
      smallBusiness: true,
    });
    const f = await client.post(`/api/v1/billing-documents/${d.json.id}/finalize`, {});
    expect(f.json).toMatchObject({ taxCents: 0, grossCents: 10000 });
    expect(f.json.lines[0]).toMatchObject({ taxCategory: "E" });
  });

  it("nimmt Befreiungsgründe über die API an", async () => {
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      exemptionReasons: { E: "Steuerfrei nach § 4 Nr. 21 UStG" },
      lines: [
        { name: "Schulung", quantity: 1, unitCode: "LS", unitPriceCents: 10000, taxCategory: "E" },
      ],
    });
    const f = await client.post(`/api/v1/billing-documents/${d.json.id}/finalize`, {});
    expect(f.status).toBe(200);
  });

  it("verhindert Umhängen von Positionen und protokolliert Nummernkreis-Änderungen", async () => {
    const r = await invoice("rechnung", 10000);
    const draft = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      lines: [{ name: "X", quantity: 1, unitCode: "LS", unitPriceCents: 1 }],
    });
    await expect(
      db.execute(
        sql`UPDATE billing_lines SET billing_document_id = ${draft.json.id} WHERE billing_document_id = ${r.id}`,
      ),
    ).rejects.toThrow();
    await client.put("/api/v1/number-sequences/beleg:rechnung", { nextValue: 500 });
    const ev = await client.get("/api/v1/events?types=number_sequence.changed,setting.updated");
    expect(ev.json.items.map((e: { type: string }) => e.type)).toEqual([
      "setting.updated",
      "number_sequence.changed",
    ]);
  });

  it("meldet Nummernkonflikte mit importierten Belegen verständlich", async () => {
    await client.post("/api/v1/import", {
      source: "alt",
      contacts: [{ externalId: "k", kind: "person", lastName: "Alt" }],
      billingDocuments: [
        {
          externalId: "b",
          type: "rechnung",
          number: `RE-${todayIso().slice(0, 4)}-1`,
          contactExternalId: "k",
          netCents: 100,
          taxCents: 19,
          grossCents: 119,
          status: "versendet",
        },
      ],
    });
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      lines: [{ name: "X", quantity: 1, unitCode: "LS", unitPriceCents: 100 }],
    });
    const f = await client.post(`/api/v1/billing-documents/${d.json.id}/finalize`, {});
    expect(f.status).toBe(409);
    expect(f.json.message).toContain("Nummernkreis");
  });

  it("übernimmt nur Angebote und Auftragsbestätigungen", async () => {
    const r = await invoice("rechnung", 100);
    expect(
      (await client.post(`/api/v1/billing-documents/${r.id}/convert`, { type: "rechnung" })).status,
    ).toBe(422);
  });
});

describe("DATEV (#8)", () => {
  it("bucht je Steuersatz auf eigene Konten und prüft das Wirtschaftsjahr", async () => {
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      issueDate: "2026-09-10",
      lines: [
        { name: "Beratung", quantity: 1, unitCode: "LS", unitPriceCents: 10000 },
        { name: "Fachbuch", quantity: 1, unitCode: "C62", unitPriceCents: 1000, taxRatePercent: 7 },
      ],
    });
    const f = await client.post(`/api/v1/billing-documents/${d.json.id}/finalize`, {});
    await pay("129,70", f.json.number);
    await client.put("/api/v1/settings/datev", {
      consultantNumber: 1234567,
      clientNumber: 10001,
      fiscalYearStart: "07-01",
    });
    const res = await client.app.request(
      "/api/v1/exports/datev?from=2026-09-01&to=2026-09-30",
      auth,
    );
    const text = new TextDecoder("windows-1252").decode(await res.arrayBuffer());
    const [head, , ...rows] = text.trim().split("\r\n");
    expect(head?.split(";")[12]).toBe("20260701");
    expect(rows.map((r) => r.split(";").slice(0, 8).join(";")).sort()).toEqual([
      '10,70;"S";"EUR";;;"";1200;8300',
      '119,00;"S";"EUR";;;"";1200;8400',
    ]);
    const span = await client.app.request(
      "/api/v1/exports/datev?from=2026-06-01&to=2026-07-31",
      auth,
    );
    expect(span.status).toBe(422);
    expect(fiscalYearStart("2026-03-15", "07-01")).toBe("2025-07-01");
  });
});

describe("Sicherheit (#6, #13)", () => {
  it("wehrt Dekompressionsbomben in Eingangs-PDFs ab", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bomb = deflateSync(Buffer.alloc(30 * 1024 * 1024, 0x20));
    const stream = pdf.context.stream(bomb, { Filter: "FlateDecode", Type: "EmbeddedFile" });
    const spec = pdf.context.obj({
      Type: "Filespec",
      F: "factur-x.xml",
      EF: { F: pdf.context.register(stream) },
    });
    pdf.catalog.set(
      PDFName.of("Names"),
      pdf.context.obj({
        EmbeddedFiles: { Names: [pdf.context.obj("factur-x.xml"), pdf.context.register(spec)] },
      }),
    );
    const bytes = await pdf.save();
    const started = Date.now();
    await expect(extractXmlFromPdf(bytes)).rejects.toThrow("zu groß");
    expect(Date.now() - started).toBeLessThan(3000);

    const big = await client.app.request("/api/v1/incoming-invoices", {
      method: "POST",
      headers: { ...auth.headers, "content-type": "application/octet-stream" },
      body: Buffer.alloc(26 * 1024 * 1024, 1),
    });
    expect(big.status).toBe(413);
  });

  it("lässt nur echte Bild-/Audiotypen für Begehungsmedien zu", async () => {
    const o = await client.post("/api/v1/objects", { label: "Objekt" });
    const id = randomUUID();
    await client.put(`/api/v1/inspections/${id}`, {
      objectId: o.json.id,
      title: "T",
      startedAt: "2026-09-29T09:00:00+02:00",
    });
    const form = new FormData();
    form.append("kind", "foto");
    form.append(
      "file",
      new File([new Uint8Array([1])], "x.png", { type: 'image/png"><script>alert(1)</script>' }),
    );
    const res = await client.app.request(`/api/v1/inspections/${id}/media/${randomUUID()}`, {
      method: "PUT",
      headers: auth.headers,
      body: form,
    });
    expect(res.status).toBe(422);
  });
});

describe("Ereignisse (#9, #14)", () => {
  it("liefert Ereignisse erst aus, wenn frühere Transaktionen abgeschlossen sind", async () => {
    const other = createDb(process.env.TEST_DATABASE_URL as string);
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    let inserted!: () => void;
    const started = new Promise<void>((r) => {
      inserted = r;
    });
    const slow = other.db.transaction(async (tx) => {
      await recordEvents(tx, [
        { entityType: "case", entityId: randomUUID(), type: "test.slow", actor: "t" },
      ]);
      inserted();
      await hold;
    });
    await started;
    await recordEvents(db, [
      { entityType: "case", entityId: randomUUID(), type: "test.fast", actor: "t" },
    ]);
    const before = await client.get("/api/v1/events?types=test.slow,test.fast");
    expect(before.json.items).toEqual([]);
    release();
    await slow;
    await other.close();
    const after = await client.get("/api/v1/events?types=test.slow,test.fast");
    expect(after.json.items.map((e: { type: string }) => e.type)).toEqual([
      "test.slow",
      "test.fast",
    ]);
    void events;
  });

  it("protokolliert Positionen einer Begehung", async () => {
    const o = await client.post("/api/v1/objects", { label: "Objekt" });
    const id = randomUUID();
    const item = randomUUID();
    await client.put(`/api/v1/inspections/${id}`, {
      objectId: o.json.id,
      title: "T",
      startedAt: "2026-09-29T09:00:00+02:00",
    });
    await client.put(`/api/v1/inspections/${id}/items/${item}`, {
      category: "dach",
      label: "Dach",
    });
    await client.del(`/api/v1/inspections/${id}/items/${item}`);
    const ev = await client.get(`/api/v1/events?entityId=${id}`);
    expect(ev.json.items.map((e: { type: string }) => e.type)).toEqual([
      "inspection.started",
      "inspection.item_added",
      "inspection.item_removed",
    ]);
  });
});

describe("Kleinigkeiten (#15)", () => {
  it("rechnet das Tagesdatum in deutscher Zeit", () => {
    expect(todayIso(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
    expect(todayIso(new Date("2026-06-30T21:59:00Z"))).toBe("2026-06-30");
  });

  it("lässt manuell verworfene Fristen verworfen", async () => {
    const fc = await client.post(`/api/v1/cases/${caseId}/funding-cases`, {
      programCode: "beg_em_bafa",
      approvedAt: "2026-01-15",
    });
    const end = fc.json.deadlines.find((d: { title: string }) => d.title.startsWith("Ende"));
    await client.patch(`/api/v1/deadlines/${end.id}`, { status: "verworfen" });
    const upd = await client.patch(`/api/v1/funding-cases/${fc.json.id}`, {
      measureCompletedAt: "2027-01-01",
    });
    expect(upd.json.deadlines.find((d: { id: string }) => d.id === end.id).status).toBe(
      "verworfen",
    );
  });
});
