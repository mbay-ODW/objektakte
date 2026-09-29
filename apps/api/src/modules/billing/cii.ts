/**
 * Erzeugt UN/CEFACT Cross Industry Invoice (CII, D16B) nach EN 16931.
 * - Profil "xrechnung": XRechnung 3.0 (öffentliche Auftraggeber, Leitweg-ID als BT-10)
 * - Profil "en16931": ZUGFeRD 2.x / Factur-X Profil EN 16931 (zum Einbetten ins PDF)
 * Die Elementreihenfolge folgt dem XSD, sonst lehnen Validatoren die Datei ab.
 */
import {
  type CanonicalInvoice,
  computeTotals,
  EN16931_GUIDELINE,
  type Party,
  type TaxBreakdown,
  TYPE_CODES,
  XRECHNUNG_GUIDELINE,
} from "./model.js";

export type CiiProfile = "xrechnung" | "en16931";

const NS = [
  'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"',
  'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"',
  'xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"',
  'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"',
].join(" ");

export function xmlEscape(s: string): string {
  return (
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      // In XML 1.0 unzulässige Steuerzeichen entfernen
      // biome-ignore lint/suspicious/noControlCharactersInRegex: genau diese Zeichen sollen entfernt werden
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  );
}

const amount = (cents: number) => (cents / 100).toFixed(2);
const d102 = (iso: string) => iso.replace(/-/g, "");

function quantity(q: number): string {
  return q.toFixed(4).replace(/\.?0+$/, "") || "0";
}

function rate(r: number): string {
  return r.toFixed(2);
}

/** Einfacher Element-Baukasten: leere/undefinierte Inhalte werden weggelassen. */
function el(name: string, content: string | null | undefined, attrs = ""): string {
  if (content === null || content === undefined || content === "") return "";
  return `<${name}${attrs ? ` ${attrs}` : ""}>${content}</${name}>`;
}
const text = (name: string, value: string | null | undefined, attrs = "") =>
  value ? el(name, xmlEscape(value), attrs) : "";
const date102 = (name: string, iso: string | null | undefined, ns = "udt") =>
  iso ? el(name, `<${ns}:DateTimeString format="102">${d102(iso)}</${ns}:DateTimeString>`) : "";

function party(tag: string, p: Party, withContact: boolean): string {
  const contact =
    withContact && (p.contactName || p.phone || p.email)
      ? el(
          "ram:DefinedTradeContact",
          [
            text("ram:PersonName", p.contactName),
            p.phone
              ? el("ram:TelephoneUniversalCommunication", text("ram:CompleteNumber", p.phone))
              : "",
            p.email ? el("ram:EmailURIUniversalCommunication", text("ram:URIID", p.email)) : "",
          ].join(""),
        )
      : "";
  const address = el(
    "ram:PostalTradeAddress",
    [
      text("ram:PostcodeCode", p.postalCode),
      text("ram:LineOne", p.street),
      text("ram:CityName", p.city),
      text("ram:CountryID", p.country),
    ].join(""),
  );
  const electronic = p.email
    ? el("ram:URIUniversalCommunication", text("ram:URIID", p.email, 'schemeID="EM"'))
    : "";
  const tax = [
    p.vatId ? el("ram:SpecifiedTaxRegistration", text("ram:ID", p.vatId, 'schemeID="VA"')) : "",
    p.taxNumber
      ? el("ram:SpecifiedTaxRegistration", text("ram:ID", p.taxNumber, 'schemeID="FC"'))
      : "",
  ].join("");
  return el(
    tag,
    [text("ram:ID", p.id), text("ram:Name", p.name), contact, address, electronic, tax].join(""),
  );
}

function headerTax(b: TaxBreakdown): string {
  return el(
    "ram:ApplicableTradeTax",
    [
      el("ram:CalculatedAmount", amount(b.taxCents)),
      el("ram:TypeCode", "VAT"),
      text("ram:ExemptionReason", b.exemptionReason),
      el("ram:BasisAmount", amount(b.basisCents)),
      el("ram:CategoryCode", b.category),
      b.category === "O" ? "" : el("ram:RateApplicablePercent", rate(b.ratePercent)),
    ].join(""),
  );
}

export function buildCii(inv: CanonicalInvoice, profile: CiiProfile): string {
  const totals = computeTotals(inv);
  const guideline = profile === "xrechnung" ? XRECHNUNG_GUIDELINE : EN16931_GUIDELINE;

  const context = el(
    "rsm:ExchangedDocumentContext",
    [
      el(
        "ram:BusinessProcessSpecifiedDocumentContextParameter",
        el("ram:ID", "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"),
      ),
      el("ram:GuidelineSpecifiedDocumentContextParameter", el("ram:ID", guideline)),
    ].join(""),
  );

  const doc = el(
    "rsm:ExchangedDocument",
    [
      text("ram:ID", inv.number),
      el("ram:TypeCode", TYPE_CODES[inv.kind]),
      date102("ram:IssueDateTime", inv.issueDate),
      ...inv.notes.filter(Boolean).map((n) => el("ram:IncludedNote", text("ram:Content", n))),
    ].join(""),
  );

  const lines = inv.lines
    .map((l, i) =>
      el(
        "ram:IncludedSupplyChainTradeLineItem",
        [
          el("ram:AssociatedDocumentLineDocument", el("ram:LineID", String(l.position))),
          el(
            "ram:SpecifiedTradeProduct",
            [
              text("ram:SellerAssignedID", l.articleCode),
              text("ram:Name", l.name),
              text("ram:Description", l.description),
            ].join(""),
          ),
          el(
            "ram:SpecifiedLineTradeAgreement",
            el("ram:NetPriceProductTradePrice", el("ram:ChargeAmount", amount(l.unitPriceCents))),
          ),
          el(
            "ram:SpecifiedLineTradeDelivery",
            el("ram:BilledQuantity", quantity(l.quantity), `unitCode="${xmlEscape(l.unitCode)}"`),
          ),
          el(
            "ram:SpecifiedLineTradeSettlement",
            [
              el(
                "ram:ApplicableTradeTax",
                [
                  el("ram:TypeCode", "VAT"),
                  el("ram:CategoryCode", l.taxCategory),
                  l.taxCategory === "O"
                    ? ""
                    : el("ram:RateApplicablePercent", rate(l.taxRatePercent)),
                ].join(""),
              ),
              el(
                "ram:SpecifiedTradeSettlementLineMonetarySummation",
                el("ram:LineTotalAmount", amount(totals.lineNets[i] ?? 0)),
              ),
            ].join(""),
          ),
        ].join(""),
      ),
    )
    .join("");

  const agreement = el(
    "ram:ApplicableHeaderTradeAgreement",
    [
      text("ram:BuyerReference", inv.buyerReference),
      party("ram:SellerTradeParty", inv.seller, true),
      party("ram:BuyerTradeParty", inv.buyer, false),
      inv.orderReference
        ? el("ram:BuyerOrderReferencedDocument", text("ram:IssuerAssignedID", inv.orderReference))
        : "",
    ].join(""),
  );

  const delivery = el(
    "ram:ApplicableHeaderTradeDelivery",
    inv.serviceDate
      ? el("ram:ActualDeliverySupplyChainEvent", date102("ram:OccurrenceDateTime", inv.serviceDate))
      : "",
  );
  // ApplicableHeaderTradeDelivery ist Pflicht, darf aber leer sein
  const deliveryXml = delivery || "<ram:ApplicableHeaderTradeDelivery/>";

  const paymentMeans = inv.payment.iban
    ? el(
        "ram:SpecifiedTradeSettlementPaymentMeans",
        [
          el("ram:TypeCode", "58"),
          el(
            "ram:PayeePartyCreditorFinancialAccount",
            [
              text("ram:IBANID", inv.payment.iban.replace(/\s/g, "")),
              text("ram:AccountName", inv.payment.accountName),
            ].join(""),
          ),
          inv.payment.bic
            ? el(
                "ram:PayeeSpecifiedCreditorFinancialInstitution",
                text("ram:BICID", inv.payment.bic),
              )
            : "",
        ].join(""),
      )
    : "";

  const period = inv.servicePeriod
    ? el(
        "ram:BillingSpecifiedPeriod",
        [
          date102("ram:StartDateTime", inv.servicePeriod.start),
          date102("ram:EndDateTime", inv.servicePeriod.end),
        ].join(""),
      )
    : "";

  const terms =
    inv.payment.termsText || inv.dueDate
      ? el(
          "ram:SpecifiedTradePaymentTerms",
          [
            text("ram:Description", inv.payment.termsText),
            date102("ram:DueDateDateTime", inv.dueDate),
          ].join(""),
        )
      : "";

  const summation = el(
    "ram:SpecifiedTradeSettlementHeaderMonetarySummation",
    [
      el("ram:LineTotalAmount", amount(totals.lineTotalCents)),
      el("ram:TaxBasisTotalAmount", amount(totals.taxBasisCents)),
      el("ram:TaxTotalAmount", amount(totals.taxCents), `currencyID="${xmlEscape(inv.currency)}"`),
      el("ram:GrandTotalAmount", amount(totals.grandTotalCents)),
      totals.prepaidCents !== 0 ? el("ram:TotalPrepaidAmount", amount(totals.prepaidCents)) : "",
      el("ram:DuePayableAmount", amount(totals.duePayableCents)),
    ].join(""),
  );

  const preceding = inv.precedingInvoice
    ? el(
        "ram:InvoiceReferencedDocument",
        [
          text("ram:IssuerAssignedID", inv.precedingInvoice.number),
          date102("ram:FormattedIssueDateTime", inv.precedingInvoice.issueDate, "qdt"),
        ].join(""),
      )
    : "";

  const settlement = el(
    "ram:ApplicableHeaderTradeSettlement",
    [
      text("ram:PaymentReference", inv.payment.reference),
      text("ram:InvoiceCurrencyCode", inv.currency),
      paymentMeans,
      ...totals.breakdown.map(headerTax),
      period,
      terms,
      summation,
      preceding,
    ].join(""),
  );

  const transaction = el(
    "rsm:SupplyChainTradeTransaction",
    [lines, agreement, deliveryXml, settlement].join(""),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>\n<rsm:CrossIndustryInvoice ${NS}>${context}${doc}${transaction}</rsm:CrossIndustryInvoice>\n`;
}
