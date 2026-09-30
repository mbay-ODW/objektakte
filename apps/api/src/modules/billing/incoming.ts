/**
 * Liest eingehende E-Rechnungen (XRechnung/ZUGFeRD/Factur-X): CII oder UBL, als XML oder als
 * PDF mit eingebetteter XML. Es werden die für Prüfung, Zahlung und Buchhaltung nötigen Kopfdaten
 * übernommen; die Originaldatei bleibt maßgeblich.
 */
import { inflateSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
} from "pdf-lib";

export interface ParsedIncomingInvoice {
  syntax: "cii" | "ubl";
  typeCode: string | null;
  number: string;
  issueDate: string | null;
  dueDate: string | null;
  sellerName: string | null;
  sellerVatId: string | null;
  buyerReference: string | null;
  currency: string;
  netCents: number | null;
  taxCents: number | null;
  grossCents: number | null;
  payableCents: number | null;
  iban: string | null;
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  parseTagValue: false,
  // Keine Entitäten auflösen (Schutz vor Entity-Expansion)
  processEntities: false,
});

type Node = Record<string, unknown> | string | undefined;

function get(node: Node, ...path: string[]): Node {
  let cur: unknown = node;
  for (const p of path) {
    if (cur === undefined || cur === null || typeof cur !== "object") return undefined;
    const next = (cur as Record<string, unknown>)[p];
    cur = Array.isArray(next) ? next[0] : next;
  }
  return cur as Node;
}

function all(node: Node, ...path: string[]): Node[] {
  const last = path[path.length - 1] as string;
  const parent = get(node, ...path.slice(0, -1));
  if (!parent || typeof parent !== "object") return [];
  const v = (parent as Record<string, unknown>)[last];
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]) as Node[];
}

function str(node: Node): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string") return node.trim() || null;
  const t = (node as Record<string, unknown>)["#text"];
  return typeof t === "string" ? t.trim() || null : null;
}

function cents(node: Node): number | null {
  const s = str(node);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function date102(node: Node): string | null {
  const s = str(get(node, "DateTimeString")) ?? str(node);
  if (!s) return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

export function parseInvoiceXml(xml: string): ParsedIncomingInvoice {
  const doc = parser.parse(xml) as Record<string, Node>;
  if (doc.CrossIndustryInvoice) {
    const root = doc.CrossIndustryInvoice;
    const tx = get(root, "SupplyChainTradeTransaction");
    const agreement = get(tx, "ApplicableHeaderTradeAgreement");
    const settlement = get(tx, "ApplicableHeaderTradeSettlement");
    const sum = get(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
    const seller = get(agreement, "SellerTradeParty");
    const vat = all(seller, "SpecifiedTaxRegistration")
      .map((r) => get(r, "ID"))
      .find(
        (id) => typeof id === "object" && (id as Record<string, unknown>)["@schemeID"] === "VA",
      );
    const number = str(get(root, "ExchangedDocument", "ID"));
    if (!number) throw new Error("Rechnungsnummer fehlt");
    return {
      syntax: "cii",
      typeCode: str(get(root, "ExchangedDocument", "TypeCode")),
      number,
      issueDate: date102(get(root, "ExchangedDocument", "IssueDateTime")),
      dueDate: date102(get(settlement, "SpecifiedTradePaymentTerms", "DueDateDateTime")),
      sellerName: str(get(seller, "Name")),
      sellerVatId: str(vat),
      buyerReference: str(get(agreement, "BuyerReference")),
      currency: str(get(settlement, "InvoiceCurrencyCode")) ?? "EUR",
      netCents: cents(get(sum, "TaxBasisTotalAmount")),
      taxCents: cents(get(sum, "TaxTotalAmount")),
      grossCents: cents(get(sum, "GrandTotalAmount")),
      payableCents: cents(get(sum, "DuePayableAmount")),
      iban: str(
        get(
          settlement,
          "SpecifiedTradeSettlementPaymentMeans",
          "PayeePartyCreditorFinancialAccount",
          "IBANID",
        ),
      ),
    };
  }
  const ublRoot = doc.Invoice ?? doc.CreditNote;
  if (ublRoot) {
    const supplier = get(ublRoot, "AccountingSupplierParty", "Party");
    const totals = get(ublRoot, "LegalMonetaryTotal");
    const number = str(get(ublRoot, "ID"));
    if (!number) throw new Error("Rechnungsnummer fehlt");
    return {
      syntax: "ubl",
      typeCode: str(get(ublRoot, "InvoiceTypeCode")) ?? str(get(ublRoot, "CreditNoteTypeCode")),
      number,
      issueDate: date102(get(ublRoot, "IssueDate")),
      dueDate:
        date102(get(ublRoot, "DueDate")) ?? date102(get(ublRoot, "PaymentMeans", "PaymentDueDate")),
      sellerName:
        str(get(supplier, "PartyLegalEntity", "RegistrationName")) ??
        str(get(supplier, "PartyName", "Name")),
      sellerVatId: str(get(supplier, "PartyTaxScheme", "CompanyID")),
      buyerReference: str(get(ublRoot, "BuyerReference")),
      currency: str(get(ublRoot, "DocumentCurrencyCode")) ?? "EUR",
      netCents: cents(get(totals, "TaxExclusiveAmount")),
      taxCents: cents(get(ublRoot, "TaxTotal", "TaxAmount")),
      grossCents: cents(get(totals, "TaxInclusiveAmount")),
      payableCents: cents(get(totals, "PayableAmount")),
      iban: str(get(ublRoot, "PaymentMeans", "PayeeFinancialAccount", "ID")),
    };
  }
  throw new Error("Keine E-Rechnung (weder CII noch UBL)");
}

const KNOWN_NAMES = ["factur-x.xml", "zugferd-invoice.xml", "xrechnung.xml", "ZUGFeRD-invoice.xml"];

/** Holt die eingebettete Rechnungs-XML aus einem ZUGFeRD/Factur-X-PDF. */
export async function extractXmlFromPdf(pdf: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const tree = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const files: { name: string; spec: PDFDict }[] = [];
  // Namensbaum mit Tiefen- und Zyklusschutz durchlaufen (Eingaben sind nicht vertrauenswürdig)
  const seen = new Set<PDFDict>();
  const walk = (node: PDFDict | undefined, depth = 0) => {
    if (!node || depth > 10 || seen.has(node) || files.length > 50) return;
    seen.add(node);
    const arr = node.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (arr) {
      for (let i = 0; i + 1 < arr.size(); i += 2) {
        const key = arr.lookup(i);
        const name =
          key instanceof PDFString || key instanceof PDFHexString ? key.decodeText() : String(key);
        const spec = arr.lookup(i + 1);
        if (spec instanceof PDFDict) files.push({ name, spec });
      }
    }
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) {
      for (let i = 0; i < kids.size(); i++) {
        const kid = kids.lookup(i);
        if (kid instanceof PDFDict) walk(kid, depth + 1);
      }
    }
  };
  walk(tree);
  const match =
    files.find((f) => KNOWN_NAMES.includes(f.name)) ??
    files.find((f) => f.name.toLowerCase().endsWith(".xml"));
  if (!match) throw new Error("PDF enthält keine eingebettete E-Rechnung");
  const ef = match.spec.lookupMaybe(PDFName.of("EF"), PDFDict);
  const stream = ef?.lookup(PDFName.of("F"));
  if (!(stream instanceof PDFRawStream)) throw new Error("Eingebettete Datei nicht lesbar");
  return new TextDecoder().decode(inflateEmbedded(stream));
}

/** Höchstgröße einer eingebetteten Rechnungs-XML nach dem Entpacken (Schutz vor Zip-Bomben). */
export const MAX_EMBEDDED_XML_BYTES = 5 * 1024 * 1024;

function inflateEmbedded(stream: PDFRawStream): Uint8Array {
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  const raw = stream.getContents();
  if (filter === undefined) {
    if (raw.length > MAX_EMBEDDED_XML_BYTES) throw new Error("Eingebettete Datei zu groß");
    return raw;
  }
  const name = filter instanceof PDFArray && filter.size() === 1 ? filter.lookup(0) : filter;
  if (name !== PDFName.of("FlateDecode")) throw new Error("Nicht unterstützte Komprimierung");
  try {
    return inflateSync(raw, { maxOutputLength: MAX_EMBEDDED_XML_BYTES });
  } catch (err) {
    throw new Error(
      (err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE"
        ? "Eingebettete Datei zu groß"
        : "Eingebettete Datei nicht lesbar",
    );
  }
}

export async function parseIncomingFile(
  bytes: Uint8Array,
): Promise<{ xml: string; parsed: ParsedIncomingInvoice; kind: "pdf" | "xml" }> {
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  const xml = isPdf ? await extractXmlFromPdf(bytes) : new TextDecoder().decode(bytes);
  return { xml, parsed: parseInvoiceXml(xml), kind: isPdf ? "pdf" : "xml" };
}
