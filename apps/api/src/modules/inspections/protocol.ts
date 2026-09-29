import type { inspectionItems, inspectionMedia, inspections, objects } from "../../db/schema.js";
import { BASE_CSS, esc, escMultiline, formatDateTimeDe } from "../../lib/html.js";

export const CATEGORY_LABELS: Record<string, string> = {
  gebaeude_allgemein: "Gebäude allgemein",
  aussenwand: "Außenwand",
  dach: "Dach",
  oberste_geschossdecke: "Oberste Geschossdecke",
  kellerdecke: "Kellerdecke",
  bodenplatte: "Bodenplatte",
  fenster: "Fenster",
  tueren: "Türen",
  heizung: "Heizung",
  warmwasser: "Warmwasser",
  lueftung: "Lüftung",
  kuehlung: "Kühlung",
  beleuchtung: "Beleuchtung",
  pv_solar: "PV / Solarthermie",
  elektro: "Elektro",
  zone: "Zone / Nutzung",
  sonstiges: "Sonstiges",
};

interface ProtocolInput {
  detail: typeof inspections.$inferSelect & {
    items: (typeof inspectionItems.$inferSelect)[];
    media: (typeof inspectionMedia.$inferSelect)[];
  };
  object: typeof objects.$inferSelect | null;
  caseNumber: string | null;
  /** mediaId → data-URI */
  images: Map<string, string>;
}

export function renderProtocolHtml({ detail, object, caseNumber, images }: ProtocolInput): string {
  const participants = (detail.participants as { name: string; role?: string | null }[])
    .map((p) => `${esc(p.name)}${p.role ? ` (${esc(p.role)})` : ""}`)
    .join(", ");
  const mediaFor = (itemId: string | null) => detail.media.filter((m) => m.itemId === itemId);

  const renderMedia = (list: typeof detail.media) => {
    const photos = list
      .filter((m) => m.kind === "foto" && images.has(m.id))
      .map(
        (m) =>
          `<figure><img src="${images.get(m.id)}" alt=""><figcaption>${esc(m.caption ?? "")}</figcaption></figure>`,
      )
      .join("");
    const notes = list
      .filter((m) => m.kind === "audio")
      .map(
        (m) =>
          `<p class="voice"><strong>Sprachnotiz${m.caption ? ` – ${esc(m.caption)}` : ""}:</strong> ${
            m.transcriptStatus === "fertig"
              ? escMultiline(m.transcript)
              : `<span class="muted">(Transkript ${esc(m.transcriptStatus)})</span>`
          }</p>`,
      )
      .join("");
    return `${notes}${photos ? `<div class="photos">${photos}</div>` : ""}`;
  };

  const items = detail.items
    .map((i) => {
      const attrs = Object.entries(i.attributes as Record<string, unknown>)
        .map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join("");
      return `<section class="item">
        <h3>${esc(CATEGORY_LABELS[i.category] ?? i.category)}: ${esc(i.label)}${i.location ? ` <span class="muted">– ${esc(i.location)}</span>` : ""}</h3>
        ${i.condition ? `<p>Zustand: <strong>${esc(i.condition)}</strong></p>` : ""}
        ${attrs ? `<table class="attrs">${attrs}</table>` : ""}
        ${i.notes ? `<p>${escMultiline(i.notes)}</p>` : ""}
        ${renderMedia(mediaFor(i.id))}
      </section>`;
    })
    .join("");

  const general = mediaFor(null);
  const address = object
    ? [object.street, [object.postalCode, object.city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Begehungsprotokoll</title>
<style>${BASE_CSS}
  .item { margin-bottom: 5mm; page-break-inside: avoid; }
  .item h3 { font-size: 10.5pt; margin: 3mm 0 1mm; }
  .attrs td { padding: 0.5mm 2mm 0.5mm 0; border-bottom: 0.2mm solid #ddd; }
  .photos { display: flex; flex-wrap: wrap; gap: 3mm; margin-top: 2mm; }
  figure { margin: 0; width: 55mm; }
  figure img { width: 55mm; height: 41mm; object-fit: cover; border: 0.2mm solid #ccc; }
  figcaption { font-size: 8pt; color: #555; }
  .voice { background: #f5f5f5; padding: 2mm; }
  .meta td:first-child { width: 40mm; color: #555; }
  footer { margin-top: 8mm; font-size: 8pt; color: #666; }
</style></head><body>
<h1>Begehungsprotokoll</h1>
<table class="meta">
  <tr><td>Objekt</td><td>${esc(object?.label ?? "")}${address ? `<br>${esc(address)}` : ""}</td></tr>
  ${caseNumber ? `<tr><td>Vorgang</td><td>${esc(caseNumber)}</td></tr>` : ""}
  <tr><td>Anlass</td><td>${esc(detail.title)}</td></tr>
  <tr><td>Beginn / Ende</td><td>${esc(formatDateTimeDe(detail.startedAt))} – ${esc(formatDateTimeDe(detail.endedAt))}</td></tr>
  ${participants ? `<tr><td>Teilnehmende</td><td>${participants}</td></tr>` : ""}
  ${detail.weather ? `<tr><td>Witterung</td><td>${esc(detail.weather)}</td></tr>` : ""}
</table>
${detail.notes ? `<h2>Allgemeines</h2><p>${escMultiline(detail.notes)}</p>` : ""}
${general.length > 0 ? `<h2>Allgemeine Aufnahmen</h2>${renderMedia(general)}` : ""}
<h2>Aufnahme</h2>
${items || '<p class="muted">Keine Positionen erfasst.</p>'}
<footer>Abgeschlossen am ${esc(formatDateTimeDe(detail.finalizedAt))}. Integritätsnachweis (SHA-256): ${esc(detail.contentHash ?? "")}</footer>
</body></html>`;
}
