import { describe, expect, it } from "vitest";
import { parseMustangReport } from "../src/adapters/validator.js";
import { buildCii, xmlEscape } from "../src/modules/billing/cii.js";
import { buildSrgbLikeIcc } from "../src/modules/billing/icc.js";
import { extractXmlFromPdf, parseInvoiceXml } from "../src/modules/billing/incoming.js";
import { computeTotals, lineNetCents, roundCents } from "../src/modules/billing/model.js";
import { renderDocumentPdf } from "../src/modules/billing/pdf.js";
import { checkInvoice } from "../src/modules/billing/rules.js";
import { sampleInvoice } from "./fixtures/invoice.js";

describe("Summen", () => {
  it("rundet kaufmännisch und rechnet Steuer je Satz auf die Summe", () => {
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(-0.5)).toBe(-1);
    expect(roundCents(2.4999)).toBe(2);
    expect(lineNetCents({ quantity: 2.5, unitPriceCents: 9500 })).toBe(23750);
    expect(lineNetCents({ quantity: 0.333, unitPriceCents: 1000 })).toBe(333);
    const t = computeTotals(
      sampleInvoice({
        lines: [
          ...sampleInvoice().lines,
          {
            position: 3,
            articleCode: null,
            name: "Buch",
            description: null,
            quantity: 3,
            unitCode: "C62",
            unitPriceCents: 1333,
            taxCategory: "S",
            taxRatePercent: 7,
          },
        ],
        prepaidCents: 100000,
      }),
    );
    expect(t.lineTotalCents).toBe(250000 + 23750 + 3999);
    expect(t.breakdown).toEqual([
      {
        category: "S",
        ratePercent: 19,
        basisCents: 273750,
        taxCents: 52013,
        exemptionReason: null,
      },
      { category: "S", ratePercent: 7, basisCents: 3999, taxCents: 280, exemptionReason: null },
    ]);
    expect(t.grandTotalCents).toBe(277749 + 52293);
    expect(t.duePayableCents).toBe(t.grandTotalCents - 100000);
  });
});

describe("Vorprüfung", () => {
  it("meldet fehlende XRechnung-Pflichtangaben verständlich", () => {
    const base = sampleInvoice();
    const inv = sampleInvoice({
      buyerReference: null,
      seller: { ...base.seller, phone: null },
      buyer: { ...base.buyer, email: null },
      payment: { ...base.payment, iban: null },
    });
    expect(checkInvoice(inv, "xrechnung").map((v) => v.rule)).toEqual([
      "BR-DE-15",
      "BR-DE-6",
      "PEPPOL-EN16931-R010",
      "BR-DE-1",
    ]);
    // Für ZUGFeRD (EN 16931) sind diese Angaben nicht Pflicht
    expect(checkInvoice(inv, "en16931")).toEqual([]);
  });

  it("verlangt Befreiungsgrund und Kennungen bei Sonderfällen", () => {
    const base = sampleInvoice();
    const exempt = sampleInvoice({
      seller: { ...base.seller, vatId: null, taxNumber: "007/123/45678", id: null },
      lines: base.lines.map((l) => ({ ...l, taxCategory: "E" as const, taxRatePercent: 0 })),
    });
    expect(checkInvoice(exempt, "en16931").map((v) => v.rule)).toEqual(["BR-CO-26", "BR-E-10"]);
    const ae = sampleInvoice({
      lines: base.lines.map((l) => ({ ...l, taxCategory: "AE" as const, taxRatePercent: 0 })),
    });
    expect(checkInvoice(ae, "en16931").map((v) => v.rule)).toEqual(["BR-AE-10", "BR-AE-02"]);
  });
});

describe("CII", () => {
  it("escaped Sonderzeichen und entfernt unzulässige Steuerzeichen", () => {
    expect(xmlEscape('A & B <"x">\u0001')).toBe("A &amp; B &lt;&quot;x&quot;&gt;");
    const xml = buildCii(sampleInvoice({ notes: ["Müller & Söhne <Test>"] }), "xrechnung");
    expect(xml).toContain("Müller &amp; Söhne &lt;Test&gt;");
    expect(xml).toContain("urn:xeinkauf.de:kosit:xrechnung_3.0");
    expect(xml).toContain("<ram:BuyerReference>991-12345-67</ram:BuyerReference>");
  });

  it("lässt sich wieder einlesen (Rundlauf)", () => {
    const parsed = parseInvoiceXml(buildCii(sampleInvoice(), "en16931"));
    expect(parsed).toMatchObject({
      syntax: "cii",
      typeCode: "380",
      number: "RE-2026-0001",
      issueDate: "2026-09-29",
      dueDate: "2026-10-13",
      sellerName: "Energieberatung Muster",
      sellerVatId: "DE123456789",
      netCents: 273750,
      taxCents: 52013,
      grossCents: 325763,
      payableCents: 325763,
      iban: "DE02120300000000202051",
    });
  });

  it("liest UBL-Rechnungen", () => {
    const ubl = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
      <cbc:ID>L-4711</cbc:ID><cbc:IssueDate>2026-09-01</cbc:IssueDate><cbc:DueDate>2026-09-15</cbc:DueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
      <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode><cbc:BuyerReference>04011000-12345-03</cbc:BuyerReference>
      <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>DE999999999</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Lieferant GmbH</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
      <cac:PaymentMeans><cac:PayeeFinancialAccount><cbc:ID>DE75512108001245126199</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
      <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount></cac:TaxTotal>
      <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">119.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
    </Invoice>`;
    expect(parseInvoiceXml(ubl)).toMatchObject({
      syntax: "ubl",
      number: "L-4711",
      sellerName: "Lieferant GmbH",
      sellerVatId: "DE999999999",
      buyerReference: "04011000-12345-03",
      netCents: 10000,
      taxCents: 1900,
      grossCents: 11900,
      dueDate: "2026-09-15",
      iban: "DE75512108001245126199",
    });
    expect(() => parseInvoiceXml("<foo/>")).toThrow("Keine E-Rechnung");
  });
});

describe("PDF", () => {
  it("bettet die E-Rechnung ein und setzt PDF/A-Kennungen", async () => {
    const inv = sampleInvoice({ buyerReference: null });
    const xml = buildCii(inv, "en16931");
    const pdf = await renderDocumentPdf({
      title: "Rechnung",
      number: inv.number,
      issueDate: inv.issueDate,
      seller: {
        ...inv.seller,
        iban: inv.payment.iban,
        bic: inv.payment.bic,
        bankName: null,
        website: null,
      },
      buyer: inv.buyer,
      meta: [],
      intro: "Test",
      lines: Array.from({ length: 40 }, (_, i) => ({
        ...inv.lines[0]!,
        position: i + 1,
        description: "lange Beschreibung ".repeat(8),
      })),
      prepaidCents: 0,
      exemptionReasons: {},
      closing: ["Danke"],
      attachment: { xml, conformanceLevel: "EN 16931", documentType: "INVOICE" },
      createdAt: new Date("2026-09-29T10:00:00Z"),
    });
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(text).toContain("/AFRelationship /Alternative");
    expect(text).toContain("/OutputIntents");
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    expect(await extractXmlFromPdf(pdf)).toBe(xml);
  });

  it("erzeugt ein gültiges ICC-Profil", () => {
    const icc = buildSrgbLikeIcc();
    const view = new DataView(icc.buffer);
    expect(view.getUint32(0)).toBe(icc.length);
    expect(new TextDecoder().decode(icc.slice(36, 40))).toBe("acsp");
    expect(new TextDecoder().decode(icc.slice(12, 20))).toBe("mntrRGB ");
  });
});

describe("Validator-Bericht", () => {
  it("wertet gültige und ungültige Berichte aus", () => {
    expect(
      parseMustangReport(
        '<validation><xml><summary status="valid"/></xml><summary status="valid"/></validation>',
      ),
    ).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
    const bad = parseMustangReport(
      '<validation><xml><error type="27">[BR-DE-15] Käuferreferenz &quot;fehlt&quot;</error><summary status="invalid"/></xml><summary status="invalid"/></validation>',
    );
    expect(bad).toEqual({
      valid: false,
      errors: ['[BR-DE-15] Käuferreferenz "fehlt"'],
      warnings: [],
    });
  });
});
