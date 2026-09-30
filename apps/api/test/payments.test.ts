import { unzipSync } from "fflate";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, sampleBatch, setupTestDb, TOKEN, testClient } from "./helpers.js";

const { db, close } = setupTestDb();
const client = testClient(db);

beforeEach(async () => {
  await resetDb(db);
  // Bestand: Rechnung RE-2026-001 (1.200,00 € brutto) zu Vorgang ISFP-001, plus zwei weitere
  const batch = sampleBatch();
  batch.cases[0] = { ...batch.cases[0], status: "abrechnung" } as (typeof batch.cases)[number];
  batch.billingDocuments.push(
    {
      externalId: "b2",
      type: "rechnung",
      number: "RE-2026-002",
      caseExternalId: "p3",
      contactExternalId: "k2",
      issueDate: "2026-09-10",
      dueDate: "2026-09-24",
      netCents: 42017,
      taxCents: 7983,
      grossCents: 50000,
      status: "versendet",
    } as never,
    {
      externalId: "b3",
      type: "angebot",
      number: "ANG-2026-003",
      caseExternalId: "p2",
      contactExternalId: "k1",
      issueDate: "2026-09-01",
      netCents: 10000,
      taxCents: 1900,
      grossCents: 11900,
      status: "versendet",
    } as never,
  );
  const r = await client.post("/api/v1/import", batch);
  expect(r.status).toBe(200);
});
afterAll(() => close());

const csv = [
  "Buchungstag;Valuta;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;Verwendungszweck;Betrag;Währung",
  "16.09.2026;16.09.2026;MUSTER, MAX;DE02120300000000202051;RE-2026-001 iSFP;1.200,00;EUR",
  "20.09.2026;20.09.2026;Gemeindekasse Beispielhausen;DE00;Zahlung;300,00;EUR",
  "21.09.2026;21.09.2026;Büro Bedarf;DE11;Druckerpapier;-45,90;EUR",
].join("\n");

async function postCsv(body: string) {
  const res = await client.app.request(
    "/api/v1/bank/transactions/import-csv?account=Geschaeftskonto",
    {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/csv" },
      body,
    },
  );
  return { status: res.status, json: await res.json() };
}

describe("Bankabgleich", () => {
  it("importiert CSV idempotent und ordnet eindeutige Zahlungen automatisch zu", async () => {
    const first = await postCsv(csv);
    expect(first.json).toEqual({
      received: 3,
      imported: 3,
      duplicates: 0,
      allocated: 1,
      errors: [],
    });
    const again = await postCsv(csv);
    expect(again.json).toMatchObject({ imported: 0, duplicates: 3 });

    const list = await client.get("/api/v1/bank/transactions");
    const byName = Object.fromEntries(
      list.json.items.map((t: { counterpartyName: string }) => [t.counterpartyName, t]),
    );
    expect(byName["MUSTER, MAX"]).toMatchObject({
      status: "zugeordnet",
      allocations: [{ number: "RE-2026-001", amountCents: 120000, source: "automatisch" }],
    });
    expect(byName["Gemeindekasse Beispielhausen"].status).toBe("offen");
    expect(byName["Büro Bedarf"].suggestions).toEqual([]);

    // Vorgang ISFP-001 ist jetzt bezahlt → abgeschlossen (Status war nicht manuell gesetzt)
    const cases = await client.get("/api/v1/cases?status=abgeschlossen");
    expect(cases.json.items.map((c: { number: string }) => c.number)).toEqual(["ISFP-001"]);
    const ev = await client.get(
      `/api/v1/events?entityId=${cases.json.items[0].id}&types=case.status_changed`,
    );
    expect(ev.json.items[0].payload).toMatchObject({
      manual: false,
      changes: { status: { from: "abrechnung", to: "abgeschlossen" } },
    });
  });

  it("erlaubt Teilzahlungen, verhindert Überzuordnung und führt offene Posten", async () => {
    await postCsv(csv);
    const list = await client.get("/api/v1/bank/transactions?status=offen");
    const gemeinde = list.json.items.find((t: { amountCents: number }) => t.amountCents === 30000);
    const receivables = await client.get("/api/v1/receivables?today=2026-09-30");
    const re2 = receivables.json.items.find((r: { number: string }) => r.number === "RE-2026-002");
    expect(re2).toMatchObject({ openCents: 50000, daysOverdue: 6 });

    const tooMuch = await client.post(`/api/v1/bank/transactions/${gemeinde.id}/allocate`, {
      allocations: [{ billingDocumentId: re2.billingDocumentId, amountCents: 40000 }],
    });
    expect(tooMuch.status).toBe(422);

    const partial = await client.post(`/api/v1/bank/transactions/${gemeinde.id}/allocate`, {
      allocations: [{ billingDocumentId: re2.billingDocumentId, amountCents: 30000 }],
    });
    expect(partial.json).toMatchObject({
      status: "zugeordnet",
      allocations: [{ amountCents: 30000, source: "manuell" }],
    });
    const after = await client.get("/api/v1/receivables?today=2026-09-30&overdueOnly=true");
    expect(after.json.items).toEqual([
      expect.objectContaining({ number: "RE-2026-002", paidCents: 30000, openCents: 20000 }),
    ]);
    expect(after.json.totalOpenCents).toBe(20000);

    // Angebote sind keine Forderung
    const toOffer = await client.post(`/api/v1/bank/transactions/${gemeinde.id}/allocate`, {
      allocations: [
        {
          billingDocumentId: (await client.get("/api/v1/cases?measureCode=EM")).json.items[0].id,
          amountCents: 100,
        },
      ],
    });
    expect(toOffer.status).toBe(422);
  });

  it("ignoriert Umsätze und gleicht nach neuen Rechnungen erneut ab", async () => {
    await postCsv(csv);
    const list = await client.get("/api/v1/bank/transactions?status=offen");
    const fee = list.json.items.find((t: { amountCents: number }) => t.amountCents < 0);
    expect((await client.post(`/api/v1/bank/transactions/${fee.id}/ignore`, {})).json.status).toBe(
      "ignoriert",
    );

    // neue Rechnung über exakt 300,00 € an die Gemeinde → Betrag + Name passen
    const batch = sampleBatch({
      contacts: [],
      objects: [],
      cases: [],
      communications: [],
      documents: [],
      billingDocuments: [
        {
          externalId: "b9",
          type: "rechnung",
          number: "RE-2026-009",
          contactExternalId: "k2",
          issueDate: "2026-09-18",
          netCents: 25210,
          taxCents: 4790,
          grossCents: 30000,
          status: "versendet",
        },
      ],
    });
    expect((await client.post("/api/v1/import", batch)).status).toBe(200);
    const re = await client.post("/api/v1/bank/rematch", {});
    expect(re.json).toEqual({ checked: 1, allocated: 1 });
  });
});

describe("Auswertungen und Export", () => {
  it("rechnet Umsatz nach Soll und Ist", async () => {
    await postCsv(csv);
    const soll = await client.get(
      "/api/v1/reports/revenue?from=2026-01-01&to=2026-12-31&basis=soll",
    );
    expect(soll.json.periods).toEqual([
      { period: "2026-04", netCents: 100840, taxCents: 19160, grossCents: 120000, count: 1 },
      { period: "2026-09", netCents: 42017, taxCents: 7983, grossCents: 50000, count: 1 },
    ]);
    const ist = await client.get("/api/v1/reports/revenue?from=2026-09-01&to=2026-09-30&basis=ist");
    expect(ist.json.total).toEqual({
      netCents: 100840,
      taxCents: 19160,
      grossCents: 120000,
      count: 1,
    });
  });

  it("exportiert DATEV erst mit Einstellungen und liefert das Monatspaket", async () => {
    await postCsv(csv);
    const auth = { headers: { authorization: `Bearer ${TOKEN}` } };
    const missing = await client.app.request(
      "/api/v1/exports/datev?from=2026-09-01&to=2026-09-30",
      auth,
    );
    expect(missing.status).toBe(422);

    await client.put("/api/v1/settings/datev", { consultantNumber: 1234567, clientNumber: 10001 });
    const ok = await client.app.request(
      "/api/v1/exports/datev?from=2026-09-01&to=2026-09-30",
      auth,
    );
    expect(ok.headers.get("content-type")).toContain("windows-1252");
    const text = new TextDecoder("windows-1252").decode(await ok.arrayBuffer());
    expect(text.split("\r\n")[2]).toBe(
      '1200,00;"S";"EUR";;;"";1200;8400;"";1609;"RE-2026-001";"";;"Max Muster"',
    );

    const zip = await client.app.request("/api/v1/exports/monthly?month=2026-09", auth);
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "datev-buchungsstapel-2026-09.csv",
      "hinweise.txt",
      "offene-posten-2026-09-30.csv",
      "rechnungsausgang-2026-09.csv",
      "zahlungseingaenge-2026-09.csv",
    ]);
    expect(new TextDecoder().decode(files["hinweise.txt"])).toContain("Kein PDF zu RE-2026-002");
  });
});
