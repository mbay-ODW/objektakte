import { expect, test } from "@playwright/test";
import { apiClient, apiJson, login, uniq } from "./helpers";

const today = new Date();
const deDate = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;

/** Synthetische XRechnung (CII) eines fiktiven Lieferanten. */
function incomingXml(number: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>${number}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260915</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>04011000-12345-67</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>Handwerk Muster GmbH</ram:Name>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE999999999</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>DE02120300000000202051</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime><udt:DateTimeString format="102">20261015</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>250.00</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>250.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">47.50</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>297.50</ram:GrandTotalAmount>
        <ram:DuePayableAmount>297.50</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

test("Rechnung: Firmendaten, Artikel, Entwurf, Festschreiben, Zahlung, Eingang", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const id = uniq();
  const api = await apiClient();
  const contact = await apiJson<{ id: string }>(api, "post", "contacts", {
    kind: "person",
    firstName: "Max",
    lastName: `Muster ${id}`,
    street: "Musterweg 1",
    postalCode: "12345",
    city: "Musterstadt",
    channels: [{ kind: "email", value: `max.${id}@example.org` }],
  });
  const kase = await apiJson<{ id: string }>(api, "post", "cases", {
    title: `Energieberatung ${id}`,
    customerId: contact.id,
  });

  await login(page);

  // Firmendaten
  await page.goto("/einstellungen/firma");
  await page.getByLabel("Name", { exact: true }).fill("Energieberatung Muster");
  await page.getByLabel("Straße").fill("Beraterweg 2");
  await page.getByLabel("PLZ").fill("12345");
  await page.getByLabel("Ort").fill("Musterstadt");
  await page.getByLabel("Ansprechpartner").fill("Erika Muster");
  await page.getByLabel("E-Mail").fill("rechnung@beratung.example");
  await page.getByLabel("Telefon").fill("+49 6061 99999");
  await page.getByLabel("USt-IdNr.").fill("DE123456789");
  await page.getByLabel("Bank", { exact: true }).fill("Musterbank");
  await page.getByLabel("IBAN").fill("DE02 1203 0000 0000 2020 51");
  await page.getByLabel("BIC").fill("BYLADEM1001");
  await page.getByRole("button", { name: "Firmendaten speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  // Artikel
  await page.goto("/einstellungen/artikel");
  const newArticle = page.locator("section", {
    has: page.getByRole("heading", { name: "Neuer Artikel" }),
  });
  await newArticle.getByLabel("Kürzel").fill(`BERATUNG-${id}`);
  await newArticle.getByLabel("Bezeichnung").fill("Energieberatung je Stunde");
  await newArticle.getByLabel("Einheit").selectOption("HUR");
  await newArticle.getByLabel("Einzelpreis netto (€)").fill("120,00");
  await newArticle.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText(`BERATUNG-${id}`)).toBeVisible();

  // Rechnung aus dem Vorgang heraus
  await page.goto(`/vorgaenge/${kase.id}`);
  await page.getByRole("link", { name: "Rechnung erstellen" }).click();
  await expect(page.getByRole("heading", { name: "Neuer Beleg" })).toBeVisible();
  const line = page.getByTestId("billing-line").first();
  await line.getByLabel("Artikel").selectOption(`BERATUNG-${id}`);
  await expect(line.getByLabel("Bezeichnung")).toHaveValue("Energieberatung je Stunde");
  await line.getByLabel("Menge").fill("5");
  await expect(page.getByTestId("gross-total")).toHaveText(/714,00\s€/);
  await page.getByRole("button", { name: "Entwurf anlegen" }).click();

  await expect(page.getByRole("heading", { name: "Rechnung (Entwurf)" })).toBeVisible();
  await expect(page.getByTestId("check-ok")).toBeVisible();
  const draftUrl = page.url();
  const preview = await page.request.get(`${draftUrl}/vorschau`);
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toBe("application/pdf");

  // Festschreiben mit ausdrücklicher Bestätigung
  await page.getByRole("button", { name: "Festschreiben …" }).click();
  const dialog = page.getByRole("dialog", { name: "Beleg endgültig festschreiben?" });
  await expect(dialog).toContainText("nicht umkehrbar");
  await dialog.getByLabel("Ich habe Empfänger, Positionen und Beträge geprüft.").check();
  await dialog.getByRole("button", { name: "Endgültig festschreiben" }).click();
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^Rechnung RE-\d{4}-\d+$/, { timeout: 60_000 });
  const number = ((await heading.textContent()) ?? "").replace("Rechnung ", "").trim();
  await expect(page.getByText("gültig", { exact: true })).toBeVisible();

  const pdfHref = await page.getByTestId("pdf-link").getAttribute("href");
  const pdf = await page.request.get(pdfHref ?? "");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("button", { name: "Als versendet markieren" }).click();
  await expect(page.getByRole("status")).toContainText("Als versendet markiert");

  // Offener Posten erscheint
  await page.goto("/offene-posten");
  await expect(page.getByTestId("receivable").filter({ hasText: number })).toBeVisible();

  // Kontoauszug: Zahlung wird automatisch zugeordnet
  const csv = [
    "Buchungstag;Valuta;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;Verwendungszweck;Betrag;Währung",
    `${deDate};${deDate};MUSTER, MAX;DE89370400440532013000;Rechnung ${number} Beratung;714,00;EUR`,
    `${deDate};${deDate};Buerobedarf Beispiel;DE11520513735120710131;Druckerpapier;-45,90;EUR`,
  ].join("\n");
  await page.goto("/zahlungen");
  await page.getByLabel("Datei").setInputFiles({
    name: "kontoauszug.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "latin1"),
  });
  await page.getByRole("button", { name: "Einlesen" }).click();
  await expect(page.getByTestId("import-result")).toContainText("2 neu");
  await expect(page.getByTestId("import-result")).toContainText("1 automatisch zugeordnet");
  await expect(
    page.getByTestId("bank-transaction").filter({ hasText: number }).locator(".badge"),
  ).toHaveText("zugeordnet");

  await page.goto("/offene-posten");
  await expect(page.getByTestId("no-receivables")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("dashboard-open-total")).toHaveText(/0,00\s€/);

  // Vorgang zeigt den Beleg
  await page.goto(`/vorgaenge/${kase.id}`);
  await expect(page.locator("#belege")).toContainText(number);

  // Eingangsrechnung (XRechnung-XML)
  await page.goto("/eingang");
  await page.getByLabel(/Datei/).setInputFiles({
    name: `lieferant-${id}.xml`,
    mimeType: "application/xml",
    buffer: Buffer.from(incomingXml(`LI-${id}`)),
  });
  await page.getByRole("button", { name: "Hochladen" }).click();
  await expect(page.getByRole("status")).toContainText(`LI-${id}`);
  const row = page.getByTestId("incoming-invoice").filter({ hasText: `LI-${id}` });
  await expect(row).toContainText("Handwerk Muster GmbH");
  await expect(row).toContainText("297,50");
  await row.getByLabel("Status").selectOption("geprueft");
  await row.getByRole("button", { name: "Setzen" }).click();
  await expect(row.locator(".badge")).toHaveText("geprüft");
  const original = await row.getByRole("link", { name: "Original" }).getAttribute("href");
  const file = await page.request.get(original ?? "");
  expect(await file.text()).toContain(`LI-${id}`);
});

test("Vorprüfung, Storno und Zahlungserinnerung", async ({ page }) => {
  test.setTimeout(120_000);
  const id = uniq();
  const api = await apiClient();
  await apiJson(api, "put", "settings/company", {
    name: "Energieberatung Muster",
    street: "Beraterweg 2",
    postalCode: "12345",
    city: "Musterstadt",
    country: "DE",
    vatId: "DE123456789",
    email: "rechnung@beratung.example",
    phone: "+49 6061 99999",
    contactName: "Erika Muster",
    iban: "DE02120300000000202051",
  });
  const contact = await apiJson<{ id: string }>(api, "post", "contacts", {
    kind: "organisation",
    organisationName: `Gemeinde Beispiel ${id}`,
    street: "Rathausplatz 1",
    postalCode: "54321",
    city: "Beispielhausen",
  });
  const line = { name: "Energieberatung", quantity: 2, unitCode: "HUR", unitPriceCents: 10000 };

  // XRechnung ohne Leitweg-ID: Vorprüfung meldet Probleme, Festschreiben gesperrt
  const draft = await apiJson<{ id: string }>(api, "post", "billing-documents", {
    type: "rechnung",
    contactId: contact.id,
    eInvoiceFormat: "xrechnung",
    lines: [line],
  });
  await login(page);
  await page.goto(`/belege/${draft.id}`);
  await expect(page.getByTestId("check-problems")).toContainText("Leitweg-ID");
  await expect(page.getByRole("button", { name: "Festschreiben …" })).toBeDisabled();

  // Überfällige Rechnung: stornieren bzw. erinnern
  const make = async (dueDate: string) => {
    const d = await apiJson<{ id: string }>(api, "post", "billing-documents", {
      type: "rechnung",
      contactId: contact.id,
      eInvoiceFormat: "keine",
      issueDate: "2026-01-02",
      dueDate,
      lines: [line],
    });
    return apiJson<{ id: string; number: string }>(
      api,
      "post",
      `billing-documents/${d.id}/finalize`,
    );
  };
  const toCancel = await make("2026-01-16");
  const toRemind = await make("2026-01-20");

  await page.goto(`/belege/${toCancel.id}`);
  await page.getByRole("button", { name: "Stornieren …" }).click();
  const dialog = page.getByRole("dialog", { name: "Rechnung stornieren?" });
  await dialog.getByLabel("Ich möchte diese Rechnung stornieren.").check();
  await dialog.getByRole("button", { name: "Stornorechnung festschreiben" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Stornorechnung RE-/);
  await expect(page.getByText(`Rechnung ${toCancel.number}`)).toBeVisible();

  await page.goto("/offene-posten?ueberfaellig=1");
  const row = page.getByTestId("receivable").filter({ hasText: toRemind.number });
  await expect(row).toContainText("überfällig");
  await expect(page.getByTestId("receivable").filter({ hasText: toCancel.number })).toHaveCount(0);
  await row.getByRole("button", { name: "Erinnern" }).click();
  await page.getByLabel("Gebühr (€)").fill("5,00");
  await page.getByRole("button", { name: "Erzeugen und festschreiben" }).click();
  await expect(page.getByRole("status")).toContainText("Zahlungserinnerung ZE-");
});
