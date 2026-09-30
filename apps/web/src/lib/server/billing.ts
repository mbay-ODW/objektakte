/** Formulardaten des Beleg-Editors in API-Eingaben umwandeln. */
import type { components } from "$lib/api/schema";
import { DRAFT_TYPES, type DraftType } from "$lib/labels";
import { cents, text } from "./forms";

type LineInput = components["schemas"]["BillingLineInput"];
type Format = "zugferd" | "xrechnung" | "keine";

function parseLines(fd: FormData): LineInput[] | string {
  const raw = fd.get("lines");
  if (typeof raw !== "string") return "Positionen fehlen";
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return "Positionen unlesbar";
  }
  if (!Array.isArray(data) || data.length === 0) return "Mindestens eine vollständige Position";
  return data.map((l: Record<string, unknown>) => ({
    articleCode: typeof l.articleCode === "string" && l.articleCode ? l.articleCode : null,
    name: String(l.name ?? ""),
    description: typeof l.description === "string" && l.description ? l.description : null,
    quantity: Number(l.quantity),
    unitCode: String(l.unitCode ?? "C62"),
    unitPriceCents: Math.round(Number(l.unitPriceCents)),
    taxCategory: String(l.taxCategory ?? "S") as LineInput["taxCategory"] & string,
    taxRatePercent: Number(l.taxRatePercent ?? 0),
  }));
}

export function parseBillingForm(fd: FormData) {
  const lines = parseLines(fd);
  if (typeof lines === "string") return { error: lines } as const;
  const contactId = text(fd, "contactId");
  if (!contactId) return { error: "Kunde wählen" } as const;
  const format = text(fd, "eInvoiceFormat") as Format | null;
  const fields = {
    contactId,
    caseId: text(fd, "caseId"),
    issueDate: text(fd, "issueDate"),
    dueDate: text(fd, "dueDate"),
    serviceDate: text(fd, "serviceDate"),
    servicePeriodStart: text(fd, "servicePeriodStart"),
    servicePeriodEnd: text(fd, "servicePeriodEnd"),
    buyerReference: text(fd, "buyerReference"),
    orderReference: text(fd, "orderReference"),
    intro: text(fd, "intro"),
    closing: text(fd, "closing"),
    paymentTermsText: text(fd, "paymentTermsText"),
    eInvoiceFormat: format ?? undefined,
    prepaidCents: fd.has("prepaid") ? cents(fd, "prepaid") : undefined,
    lines,
  };
  const typeValue = text(fd, "type");
  const type = DRAFT_TYPES.includes(typeValue as DraftType) ? (typeValue as DraftType) : null;
  return { fields, type } as const;
}
