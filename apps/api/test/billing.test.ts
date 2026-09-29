import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { extractXmlFromPdf } from "../src/modules/billing/incoming.js";
import { resetDb, setupTestDb, TOKEN, testClient, testServices } from "./helpers.js";

const { db, close } = setupTestDb();
const services = testServices();
const client = testClient(db, services);
const realValidator = Boolean(process.env.EINVOICE_VALIDATOR_URL);

const company = {
  name: "Energieberatung Muster",
  street: "Musterweg 1",
  postalCode: "12345",
  city: "Musterstadt",
  vatId: "DE123456789",
  email: "rechnung@beratung.example",
  phone: "+49 6061 99999",
  contactName: "Max Muster",
  bankName: "Musterbank",
  iban: "DE02120300000000202051",
  bic: "BYLADEM1001",
  numberPatterns: {
    angebot: "ANG-{YYYY}-{N}",
    auftragsbestaetigung: "AB-{YYYY}-{N}",
    rechnung: "RE-{YYYY}-{N}",
    zahlungserinnerung: "ZE-{YYYY}-{N}",
  },
};

let personId: string;
let publicId: string;
let caseId: string;

beforeEach(async () => {
  await resetDb(db);
  await client.put("/api/v1/settings/company", company);
  personId = (
    await client.post("/api/v1/contacts", {
      kind: "person",
      firstName: "Erika",
      lastName: "Beispiel",
      street: "Lindenweg 3",
      postalCode: "12345",
      city: "Musterstadt",
      customerNumber: "1001",
      channels: [{ kind: "email", value: "erika@example.org" }],
    })
  ).json.id;
  publicId = (
    await client.post("/api/v1/contacts", {
      kind: "organisation",
      organisationName: "Gemeinde Beispielhausen",
      street: "Rathausplatz 1",
      postalCode: "54321",
      city: "Beispielhausen",
      leitwegId: "991-12345-67",
      channels: [{ kind: "email", value: "rechnungseingang@beispielhausen.example" }],
    })
  ).json.id;
  caseId = (
    await client.post("/api/v1/cases", {
      number: "EM-1",
      title: "Fenstertausch",
      customerId: personId,
    })
  ).json.id;
  await client.put("/api/v1/articles/BEG-EM", {
    name: "Energieberatung BEG-Einzelmaßnahme",
    description: "Technische Projektbeschreibung, Baubegleitung, Nachweis",
    unitCode: "LS",
    unitPriceCents: 150000,
  });
});
afterAll(() => close());

const auth = { headers: { authorization: `Bearer ${TOKEN}` } };

async function finalize(id: string) {
  return client.post(`/api/v1/billing-documents/${id}/finalize`, {});
}

describe("Belegfluss", { timeout: 120_000 }, () => {
  it("Angebot → Vorschau → Festschreiben → Rechnung (ZUGFeRD) mit geprüfter E-Rechnung", async () => {
    const offer = await client.post("/api/v1/billing-documents", {
      type: "angebot",
      contactId: personId,
      caseId,
      issueDate: "2026-09-01",
      lines: [
        { articleCode: "BEG-EM", quantity: 1 },
        { name: "Zusatztermin", quantity: 2, unitCode: "HUR", unitPriceCents: 9500 },
      ],
    });
    expect(offer.status).toBe(201);
    expect(offer.json).toMatchObject({
      status: "entwurf",
      number: null,
      netCents: 169000,
      taxCents: 32110,
      grossCents: 201110,
    });

    const preview = await client.app.request(
      `/api/v1/billing-documents/${offer.json.id}/preview`,
      auth,
    );
    expect(preview.headers.get("content-type")).toBe("application/pdf");

    const fin = await finalize(offer.json.id);
    expect(fin.status).toBe(200);
    expect(fin.json).toMatchObject({
      number: "ANG-2026-1",
      status: "festgeschrieben",
      xmlDocumentId: null,
    });
    expect((await client.get(`/api/v1/cases/${caseId}`)).json.status).toBe("angebot");

    const inv = await client.post(`/api/v1/billing-documents/${offer.json.id}/convert`, {
      type: "rechnung",
    });
    expect(inv.json).toMatchObject({
      type: "rechnung",
      status: "entwurf",
      eInvoiceFormat: "zugferd",
      grossCents: 201110,
    });
    await client.patch(`/api/v1/billing-documents/${inv.json.id}`, {
      issueDate: "2026-09-29",
      serviceDate: "2026-09-20",
    });
    const invFin = await finalize(inv.json.id);
    expect(invFin.status).toBe(200);
    expect(invFin.json).toMatchObject({
      number: "RE-2026-1",
      dueDate: "2026-10-13",
      status: "festgeschrieben",
    });
    expect(invFin.json.validation).toMatchObject(
      realValidator
        ? { valid: true, validator: "mustang", errors: [] }
        : { valid: true, mode: "internal" },
    );
    expect(invFin.json.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const pdf = new Uint8Array(
      await (
        await client.app.request(`/api/v1/documents/${invFin.json.pdfDocumentId}/file`, auth)
      ).arrayBuffer(),
    );
    const xml = await extractXmlFromPdf(pdf);
    expect(xml).toContain("<ram:ID>RE-2026-1</ram:ID>");
    expect((await client.get(`/api/v1/cases/${caseId}`)).json.status).toBe("abrechnung");
  });

  it("erzeugt für öffentliche Auftraggeber eine XRechnung mit Leitweg-ID", async () => {
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: publicId,
      issueDate: "2026-09-29",
      servicePeriodStart: "2026-09-01",
      servicePeriodEnd: "2026-09-25",
      lines: [{ articleCode: "BEG-EM", quantity: 1 }],
    });
    expect(d.json.eInvoiceFormat).toBe("xrechnung");
    const fin = await finalize(d.json.id);
    expect(fin.status).toBe(200);
    expect(fin.json.buyerReference).toBe("991-12345-67");
    const xml = await (
      await client.app.request(`/api/v1/documents/${fin.json.xmlDocumentId}/file`, auth)
    ).text();
    expect(xml).toContain("urn:xeinkauf.de:kosit:xrechnung_3.0");
    expect(xml).toContain("<ram:BuyerReference>991-12345-67</ram:BuyerReference>");
    expect(xml).toContain("<ram:BillingSpecifiedPeriod>");
  });

  it("schreibt nicht fest, wenn Pflichtangaben fehlen – ohne Lücke im Nummernkreis", async () => {
    await client.put("/api/v1/settings/company", { ...company, phone: "" });
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: publicId,
      lines: [{ articleCode: "BEG-EM", quantity: 1 }],
    });
    const check = await client.get(`/api/v1/billing-documents/${d.json.id}/check`);
    expect(check.json.problems.map((p: { rule: string }) => p.rule)).toEqual(["BR-DE-6"]);
    const failed = await finalize(d.json.id);
    expect(failed.status).toBe(422);
    expect(failed.json.message).toContain("Telefonnummer des Verkäufers");
    expect((await client.get(`/api/v1/billing-documents/${d.json.id}`)).json.status).toBe(
      "entwurf",
    );

    await client.put("/api/v1/settings/company", company);
    const ok = await finalize(d.json.id);
    expect(ok.json.number).toMatch(/^RE-\d{4}-1$/);
  });

  it("schützt festgeschriebene Belege (GoBD) – auch direkt in der Datenbank", async () => {
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      lines: [{ articleCode: "BEG-EM", quantity: 1 }],
    });
    await finalize(d.json.id);
    expect(
      (await client.patch(`/api/v1/billing-documents/${d.json.id}`, { intro: "neu" })).status,
    ).toBe(409);
    expect((await client.del(`/api/v1/billing-documents/${d.json.id}`)).status).toBe(409);
    await expect(
      db.execute(sql`UPDATE billing_documents SET net_cents = 1 WHERE id = ${d.json.id}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`DELETE FROM billing_documents WHERE id = ${d.json.id}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`UPDATE billing_lines SET name = 'x' WHERE billing_document_id = ${d.json.id}`),
    ).rejects.toThrow();

    const sent = await client.post(`/api/v1/billing-documents/${d.json.id}/sent`, {
      via: "E-Mail",
    });
    expect(sent.json).toMatchObject({ status: "versendet", sentVia: "E-Mail" });
    await expect(
      db.execute(
        sql`UPDATE billing_documents SET status = 'festgeschrieben' WHERE id = ${d.json.id}`,
      ),
    ).rejects.toThrow();
  });

  it("storniert per Stornorechnung und neutralisiert Umsatz und offene Posten", async () => {
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      issueDate: "2026-09-10",
      lines: [{ articleCode: "BEG-EM", quantity: 1 }],
    });
    await finalize(d.json.id);
    expect((await client.get("/api/v1/receivables")).json.totalOpenCents).toBe(178500);

    const c = await client.post(`/api/v1/billing-documents/${d.json.id}/cancel`, {});
    expect(c.status).toBe(200);
    expect(c.json.original.status).toBe("storniert");
    expect(c.json.storno).toMatchObject({
      type: "stornorechnung",
      number: "RE-2026-2",
      grossCents: 178500,
      precedingDocumentId: d.json.id,
    });
    expect((await client.get("/api/v1/receivables")).json.totalOpenCents).toBe(0);
    const soll = await client.get(
      "/api/v1/reports/revenue?from=2026-01-01&to=2026-12-31&basis=soll",
    );
    expect(soll.json.total.grossCents).toBe(0);
    expect((await client.post(`/api/v1/billing-documents/${d.json.id}/cancel`, {})).status).toBe(
      409,
    );
  });

  it("zieht Abschlagsrechnungen in der Schlussrechnung ab", async () => {
    const a = await client.post("/api/v1/billing-documents", {
      type: "abschlagsrechnung",
      contactId: personId,
      caseId,
      lines: [
        { name: "1. Abschlag Baubegleitung", quantity: 1, unitCode: "LS", unitPriceCents: 100000 },
      ],
    });
    const aFin = await finalize(a.json.id);
    expect(aFin.status).toBe(200);
    expect((await client.get(`/api/v1/cases/${caseId}`)).json.status).toBe("in_bearbeitung");

    const s = await client.post("/api/v1/billing-documents", {
      type: "schlussrechnung",
      contactId: personId,
      caseId,
      lines: [
        { name: "Baubegleitung gesamt", quantity: 1, unitCode: "LS", unitPriceCents: 300000 },
      ],
    });
    const sFin = await finalize(s.json.id);
    expect(sFin.status).toBe(200);
    expect(sFin.json).toMatchObject({ grossCents: 357000, prepaidCents: 119000 });
    const pdf = new Uint8Array(
      await (
        await client.app.request(`/api/v1/documents/${sFin.json.pdfDocumentId}/file`, auth)
      ).arrayBuffer(),
    );
    const xml = await extractXmlFromPdf(pdf);
    expect(xml).toContain("<ram:TotalPrepaidAmount>1190.00</ram:TotalPrepaidAmount>");
    expect(xml).toContain("<ram:DuePayableAmount>2380.00</ram:DuePayableAmount>");
  });

  it("erstellt Zahlungserinnerungen nur für offene Rechnungen", async () => {
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      lines: [{ articleCode: "BEG-EM", quantity: 1 }],
    });
    await finalize(d.json.id);
    const r = await client.post(`/api/v1/billing-documents/${d.json.id}/reminder`, {
      level: 2,
      feeCents: 500,
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      type: "zahlungserinnerung",
      number: expect.stringMatching(/^ZE-\d{4}-1$/),
      grossCents: 179000,
      reminderLevel: 2,
      xmlDocumentId: null,
    });
    // Mahnungen sind keine Forderungen im Sinne der offenen Posten
    expect((await client.get("/api/v1/receivables")).json.items).toHaveLength(1);
  });

  it("unterstützt Kleinunternehmer (§ 19 UStG) mit gültiger E-Rechnung", async () => {
    await client.put("/api/v1/settings/company", {
      ...company,
      vatId: null,
      taxNumber: "007/123/45678",
      sellerId: "KU-1",
      smallBusiness: true,
    });
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      lines: [{ articleCode: "BEG-EM", quantity: 1 }],
    });
    expect(d.json).toMatchObject({ taxCents: 0, grossCents: 150000 });
    expect(d.json.lines[0]).toMatchObject({ taxCategory: "E", taxRatePercent: 0 });
    const fin = await finalize(d.json.id);
    expect(fin.status).toBe(200);
    const pdf = new Uint8Array(
      await (
        await client.app.request(`/api/v1/documents/${fin.json.pdfDocumentId}/file`, auth)
      ).arrayBuffer(),
    );
    expect(await extractXmlFromPdf(pdf)).toContain("Kleinunternehmer gemäß § 19 UStG");
  });

  it("verweigert das Festschreiben ohne Validator, wenn die Prüfung Pflicht ist", async () => {
    const strict = testClient(
      db,
      testServices({ validator: undefined, eInvoiceValidation: "required" }),
    );
    const d = await strict.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: personId,
      lines: [{ articleCode: "BEG-EM", quantity: 1 }],
    });
    const res = await strict.post(`/api/v1/billing-documents/${d.json.id}/finalize`, {});
    expect(res.status).toBe(422);
    expect(res.json.message).toContain("Kein E-Rechnungs-Validator");
  });
});

describe("Eingangsrechnungen", { timeout: 120_000 }, () => {
  it("liest ZUGFeRD-PDF und XRechnung-XML und erkennt Duplikate", async () => {
    const d = await client.post("/api/v1/billing-documents", {
      type: "rechnung",
      contactId: publicId,
      issueDate: "2026-09-29",
      lines: [{ articleCode: "BEG-EM", quantity: 1 }],
    });
    const fin = await finalize(d.json.id);
    const xml = await (
      await client.app.request(`/api/v1/documents/${fin.json.xmlDocumentId}/file`, auth)
    ).arrayBuffer();

    const upload = (body: ArrayBuffer | Uint8Array) =>
      client.app.request("/api/v1/incoming-invoices?filename=eingang.xml", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/octet-stream" },
        body: body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(new Uint8Array(body)),
      });
    const first = await upload(xml);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      syntax: "cii",
      number: "RE-2026-1",
      buyerReference: "991-12345-67",
      grossCents: 178500,
      status: "offen",
    });
    expect((await upload(xml)).status).toBe(200);

    const bad = await upload(new TextEncoder().encode("kein xml"));
    expect(bad.status).toBe(422);
    expect((await client.get("/api/v1/incoming-invoices")).json.items).toHaveLength(1);
  });
});
