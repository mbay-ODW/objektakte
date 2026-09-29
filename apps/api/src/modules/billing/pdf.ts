/**
 * Erzeugt Belege als PDF/A-3b – bei Rechnungen mit eingebetteter E-Rechnung (factur-x.xml,
 * Profil EN 16931). Layout nach DIN 5008 (Anschriftfeld Form B), alle Schriften eingebettet.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import fontkit from "@pdf-lib/fontkit";
import {
  AFRelationship,
  PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  type PDFPage,
  PDFString,
  rgb,
} from "pdf-lib";
import { buildSrgbLikeIcc } from "./icc.js";
import { computeTotals, type Line, type Party, type TaxCategory, UNIT_CODES } from "./model.js";

const require = createRequire(import.meta.url);
const fontDir = `${require.resolve("dejavu-fonts-ttf/package.json").replace(/package\.json$/, "")}ttf/`;
let fontCache: { regular: Uint8Array; bold: Uint8Array } | undefined;
function fonts() {
  fontCache ??= {
    regular: readFileSync(`${fontDir}DejaVuSans.ttf`),
    bold: readFileSync(`${fontDir}DejaVuSans-Bold.ttf`),
  };
  return fontCache;
}

export interface DocumentView {
  title: string;
  number: string;
  issueDate: string;
  seller: Party & {
    iban: string | null;
    bic: string | null;
    bankName: string | null;
    website: string | null;
  };
  buyer: Party;
  /** Zusatzangaben im Infoblock rechts: [Bezeichnung, Wert] */
  meta: [string, string][];
  intro: string | null;
  lines: Line[];
  prepaidCents: number;
  exemptionReasons: Partial<Record<TaxCategory, string>>;
  /** Texte unter der Summe (Zahlungsbedingungen, Hinweise) */
  closing: string[];
  /** Art des Summenblocks: Rechnung, Angebot oder Mahnung (ohne Steuerausweis) */
  summary?: "invoice" | "offer" | "reminder";
  /** Eingebettete E-Rechnung */
  attachment?: { xml: string; conformanceLevel: "EN 16931"; documentType: "INVOICE" };
  createdAt: Date;
}

const MM = 72 / 25.4;
const A4 = { w: 210 * MM, h: 297 * MM };
const MARGIN = { left: 25 * MM, right: 20 * MM, top: 20 * MM, bottom: 28 * MM };
const DARK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.75, 0.75, 0.75);

const euro = (cents: number) =>
  `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} €`;
const dateDe = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};
const qtyDe = (q: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 4 }).format(q);
const pct = (p: number) =>
  `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(p)} %`;

/** Bricht Text an Wortgrenzen auf eine Breite um (lange Wörter werden hart getrennt). */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

function xmpDate(d: Date) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function xmlText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildXmp(view: DocumentView, title: string): string {
  const date = xmpDate(view.createdAt);
  const fx = view.attachment
    ? `<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
  <fx:DocumentType>${view.attachment.documentType}</fx:DocumentType>
  <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
  <fx:Version>1.0</fx:Version>
  <fx:ConformanceLevel>${view.attachment.conformanceLevel}</fx:ConformanceLevel>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
  <pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
    <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
    <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
    <pdfaSchema:prefix>fx</pdfaSchema:prefix>
    <pdfaSchema:property><rdf:Seq>
      ${[
        ["DocumentFileName", "The name of the embedded XML document"],
        [
          "DocumentType",
          "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER",
        ],
        ["Version", "The actual version of the standard applying to the embedded XML document"],
        ["ConformanceLevel", "The conformance level of the embedded XML document"],
      ]
        .map(
          ([name, desc]) =>
            `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${name}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${desc}</pdfaProperty:description></rdf:li>`,
        )
        .join("\n      ")}
    </rdf:Seq></pdfaSchema:property>
  </rdf:li></rdf:Bag></pdfaExtension:schemas>
</rdf:Description>`
    : "";
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
  <pdfaid:part>3</pdfaid:part>
  <pdfaid:conformance>B</pdfaid:conformance>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:format>application/pdf</dc:format>
  <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(title)}</rdf:li></rdf:Alt></dc:title>
  <dc:creator><rdf:Seq><rdf:li>${xmlText(view.seller.name)}</rdf:li></rdf:Seq></dc:creator>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
  <xmp:CreatorTool>objektakte</xmp:CreatorTool>
  <xmp:CreateDate>${date}</xmp:CreateDate>
  <xmp:ModifyDate>${date}</xmp:ModifyDate>
  <xmp:MetadataDate>${date}</xmp:MetadataDate>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
  <pdf:Producer>objektakte</pdf:Producer>
</rdf:Description>
${fx}
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  view: DocumentView;
  pageNo: number;
}

function text(
  ctx: Ctx,
  s: string,
  x: number,
  y: number,
  size = 9,
  font = ctx.regular,
  color = DARK,
) {
  ctx.page.drawText(s, { x, y, size, font, color });
}

function textRight(ctx: Ctx, s: string, right: number, y: number, size = 9, font = ctx.regular) {
  text(ctx, s, right - font.widthOfTextAtSize(s, size), y, size, font);
}

function footer(ctx: Ctx) {
  const s = ctx.view.seller;
  const cols = [
    [s.name, s.street ?? "", [s.postalCode, s.city].filter(Boolean).join(" ")],
    [s.phone ? `Tel. ${s.phone}` : "", s.email ?? "", s.website ?? ""],
    [s.bankName ?? "", s.iban ? `IBAN ${s.iban}` : "", s.bic ? `BIC ${s.bic}` : ""],
    [s.vatId ? `USt-IdNr. ${s.vatId}` : "", s.taxNumber ? `St.-Nr. ${s.taxNumber}` : "", ""],
  ];
  const width = (A4.w - MARGIN.left - MARGIN.right) / cols.length;
  ctx.page.drawLine({
    start: { x: MARGIN.left, y: 22 * MM },
    end: { x: A4.w - MARGIN.right, y: 22 * MM },
    thickness: 0.4,
    color: LINE,
  });
  cols.forEach((col, i) => {
    col.filter(Boolean).forEach((line, j) => {
      text(ctx, line, MARGIN.left + i * width, 18 * MM - j * 9, 6.5, ctx.regular, MUTED);
    });
  });
}

function newPage(ctx: Ctx) {
  footer(ctx);
  ctx.page = ctx.doc.addPage([A4.w, A4.h]);
  ctx.pageNo++;
  ctx.y = A4.h - MARGIN.top;
  text(
    ctx,
    `${ctx.view.title} ${ctx.view.number} – Seite ${ctx.pageNo}`,
    MARGIN.left,
    ctx.y,
    8,
    ctx.regular,
    MUTED,
  );
  ctx.y -= 10 * MM;
}

function ensure(ctx: Ctx, height: number, onNewPage?: () => void) {
  if (ctx.y - height < MARGIN.bottom) {
    newPage(ctx);
    onNewPage?.();
  }
}

export async function renderDocumentPdf(view: DocumentView): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const f = fonts();
  const regular = await doc.embedFont(f.regular, { subset: true });
  const bold = await doc.embedFont(f.bold, { subset: true });
  const page = doc.addPage([A4.w, A4.h]);
  const ctx: Ctx = { doc, page, y: A4.h - MARGIN.top, regular, bold, view, pageNo: 1 };
  const contentWidth = A4.w - MARGIN.left - MARGIN.right;
  const right = A4.w - MARGIN.right;

  // Briefkopf
  text(ctx, view.seller.name, MARGIN.left, A4.h - 15 * MM, 13, bold);
  const senderLine = [
    view.seller.name,
    view.seller.street,
    [view.seller.postalCode, view.seller.city].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");
  // Anschriftfeld DIN 5008 Form B: 45 mm von oben, Rücksendeangabe darüber
  text(ctx, senderLine, MARGIN.left, A4.h - 47 * MM, 6.5, regular, MUTED);
  const buyerLines = [
    view.buyer.name,
    view.buyer.contactName ?? "",
    view.buyer.street ?? "",
    [view.buyer.postalCode, view.buyer.city].filter(Boolean).join(" "),
    view.buyer.country !== "DE" ? view.buyer.country : "",
  ].filter(Boolean);
  buyerLines.forEach((l, i) => {
    text(ctx, l, MARGIN.left, A4.h - 55 * MM - i * 12, 10);
  });

  // Infoblock rechts
  const meta: [string, string][] = [
    [`${view.title}snr.`, view.number],
    ["Datum", dateDe(view.issueDate)],
    ...view.meta,
  ];
  meta.forEach(([label, value], i) => {
    const y = A4.h - 50 * MM - i * 11;
    text(ctx, label, 125 * MM, y, 8, regular, MUTED);
    textRight(ctx, value, right, y, 8.5);
  });

  ctx.y = A4.h - 105 * MM;
  text(ctx, `${view.title} ${view.number}`, MARGIN.left, ctx.y, 14, bold);
  ctx.y -= 9 * MM;
  if (view.intro) {
    for (const l of wrap(view.intro, regular, 9.5, contentWidth)) {
      ensure(ctx, 12);
      text(ctx, l, MARGIN.left, ctx.y, 9.5);
      ctx.y -= 12;
    }
    ctx.y -= 4 * MM;
  }

  // Positionstabelle
  const col = {
    pos: MARGIN.left,
    name: MARGIN.left + 10 * MM,
    qty: MARGIN.left + 103 * MM,
    unit: MARGIN.left + 106 * MM,
    price: MARGIN.left + 145 * MM,
    total: right,
  };
  const tableHeader = () => {
    text(ctx, "Pos.", col.pos, ctx.y, 8, bold);
    text(ctx, "Bezeichnung", col.name, ctx.y, 8, bold);
    textRight(ctx, "Menge", col.qty, ctx.y, 8, bold);
    text(ctx, "Einheit", col.unit, ctx.y, 8, bold);
    textRight(ctx, "Einzelpreis", col.price, ctx.y, 8, bold);
    textRight(ctx, "Gesamt", col.total, ctx.y, 8, bold);
    ctx.y -= 4;
    ctx.page.drawLine({
      start: { x: MARGIN.left, y: ctx.y },
      end: { x: right, y: ctx.y },
      thickness: 0.6,
      color: DARK,
    });
    ctx.y -= 12;
  };
  ensure(ctx, 30);
  tableHeader();

  const totals = computeTotals({
    lines: view.lines,
    prepaidCents: view.prepaidCents,
    exemptionReasons: view.exemptionReasons,
  });
  const nameWidth = col.qty - col.name - 22 * MM;
  const multipleRates = totals.breakdown.length > 1;
  view.lines.forEach((l, i) => {
    const nameLines = wrap(l.name, bold, 9, nameWidth);
    const descLines = l.description ? wrap(l.description, regular, 8, nameWidth) : [];
    const height = nameLines.length * 11 + descLines.length * 10 + 6;
    ensure(ctx, height, tableHeader);
    text(ctx, String(l.position), col.pos, ctx.y, 9);
    textRight(ctx, qtyDe(l.quantity), col.qty, ctx.y, 9);
    text(ctx, UNIT_CODES[l.unitCode] ?? l.unitCode, col.unit, ctx.y, 9);
    textRight(ctx, euro(l.unitPriceCents), col.price, ctx.y, 9);
    textRight(ctx, euro(totals.lineNets[i] ?? 0), col.total, ctx.y, 9);
    let y = ctx.y;
    for (const nl of nameLines) {
      text(ctx, nl, col.name, y, 9, bold);
      y -= 11;
    }
    for (const dl of descLines) {
      text(ctx, dl, col.name, y, 8, regular, MUTED);
      y -= 10;
    }
    if (multipleRates) text(ctx, `USt ${pct(l.taxRatePercent)}`, col.name, y, 7, regular, MUTED);
    ctx.y = y - (multipleRates ? 10 : 4);
    ctx.page.drawLine({
      start: { x: MARGIN.left, y: ctx.y + 6 },
      end: { x: right, y: ctx.y + 6 },
      thickness: 0.3,
      color: LINE,
    });
  });

  // Summen
  const sumRows: [string, string, boolean][] = [];
  if (view.summary === "reminder") {
    sumRows.push(["Zu zahlender Betrag", euro(totals.grandTotalCents), true]);
  } else {
    sumRows.push(["Summe netto", euro(totals.lineTotalCents), false]);
    for (const b of totals.breakdown) {
      if (b.category === "S") {
        sumRows.push([
          `Umsatzsteuer ${pct(b.ratePercent)} auf ${euro(b.basisCents)}`,
          euro(b.taxCents),
          false,
        ]);
      } else if (b.category !== "O") {
        sumRows.push([
          `Umsatzsteuer ${b.category === "AE" ? "(Reverse Charge)" : "0 %"}`,
          euro(0),
          false,
        ]);
      }
    }
    sumRows.push([
      view.summary === "offer" ? "Angebotssumme brutto" : "Gesamtbetrag",
      euro(totals.grandTotalCents),
      true,
    ]);
  }
  if (totals.prepaidCents !== 0) {
    sumRows.push([
      "abzüglich bereits berechneter Abschläge",
      `- ${euro(totals.prepaidCents)}`,
      false,
    ]);
    sumRows.push(["Zahlbetrag", euro(totals.duePayableCents), true]);
  }
  ensure(ctx, sumRows.length * 13 + 10);
  ctx.y -= 4;
  for (const [label, value, strong] of sumRows) {
    const font = strong ? bold : regular;
    textRight(ctx, label, col.price, ctx.y, 9, font);
    textRight(ctx, value, col.total, ctx.y, 9, font);
    ctx.y -= 13;
  }
  ctx.y -= 4 * MM;

  // Schlusstexte, Befreiungsgründe
  const closing = [
    ...totals.breakdown.map((b) => b.exemptionReason).filter((r): r is string => Boolean(r)),
    ...view.closing,
  ];
  for (const paragraph of closing) {
    for (const l of wrap(paragraph, regular, 9, contentWidth)) {
      ensure(ctx, 12);
      text(ctx, l, MARGIN.left, ctx.y, 9);
      ctx.y -= 12;
    }
    ctx.y -= 5;
  }
  footer(ctx);

  // PDF/A-3b: Metadaten, OutputIntent, Dokument-ID, eingebettete E-Rechnung
  const title = `${view.title} ${view.number}`;
  doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setAuthor(view.seller.name);
  doc.setCreator("objektakte");
  doc.setProducer("objektakte");
  doc.setCreationDate(view.createdAt);
  doc.setModificationDate(view.createdAt);
  doc.setLanguage("de-DE");

  if (view.attachment) {
    await doc.attach(new TextEncoder().encode(view.attachment.xml), "factur-x.xml", {
      mimeType: "text/xml",
      description: "Factur-X/ZUGFeRD-Rechnung",
      creationDate: view.createdAt,
      modificationDate: view.createdAt,
      afRelationship: AFRelationship.Alternative,
    });
  }

  const ctxObj = doc.context;
  const metadata = ctxObj.stream(new TextEncoder().encode(buildXmp(view, title)), {
    Type: "Metadata",
    Subtype: "XML",
  });
  doc.catalog.set(PDFName.of("Metadata"), ctxObj.register(metadata));

  const icc = buildSrgbLikeIcc();
  const iccStream = ctxObj.flateStream(icc, { N: 3 });
  const outputIntent = ctxObj.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputConditionIdentifier: PDFString.of("sRGB"),
    Info: PDFString.of("sRGB-like RGB profile"),
    RegistryName: PDFString.of("http://www.color.org"),
    DestOutputProfile: ctxObj.register(iccStream),
  });
  doc.catalog.set(PDFName.of("OutputIntents"), ctxObj.obj([ctxObj.register(outputIntent)]));
  doc.catalog.set(PDFName.of("MarkInfo"), ctxObj.obj({ Marked: false }));

  const id = PDFHexString.of(randomBytes(16).toString("hex"));
  ctxObj.trailerInfo.ID = ctxObj.obj([id, id]);

  return doc.save({ useObjectStreams: false });
}
