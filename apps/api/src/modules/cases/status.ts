import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { billingDocuments, cases } from "../../db/schema.js";
import { recordEvents } from "../../lib/events.js";

type Status = (typeof cases.$inferSelect)["status"];

export interface CaseFacts {
  offerSent: boolean;
  orderConfirmed: boolean;
  partialInvoiced: boolean;
  /** Rechnung oder Schlussrechnung festgeschrieben/versendet (nicht storniert) */
  finalInvoiced: boolean;
  /** alle (Schluss-)Rechnungen vollständig bezahlt */
  finalPaid: boolean;
}

/**
 * Leitet den Vorgangsstatus aus Belegen und Zahlungen ab. `null` = keine Aussage möglich
 * (dann bleibt der bisherige Status stehen).
 */
export function deriveCaseStatus(f: CaseFacts): Status | null {
  if (f.finalInvoiced) return f.finalPaid ? "abgeschlossen" : "abrechnung";
  if (f.partialInvoiced || f.orderConfirmed)
    return f.partialInvoiced ? "in_bearbeitung" : "beauftragt";
  if (f.offerSent) return "angebot";
  return null;
}

const ISSUED = ["festgeschrieben", "versendet"] as const;

export async function loadCaseFacts(tx: DbOrTx, caseId: string): Promise<CaseFacts> {
  const docs = await tx
    .select({
      id: billingDocuments.id,
      type: billingDocuments.type,
      status: billingDocuments.status,
      grossCents: billingDocuments.grossCents,
      paid: sql<string>`coalesce((select sum(pa.amount_cents) from payment_allocations pa where pa.billing_document_id = "billing_documents"."id"), 0)`,
    })
    .from(billingDocuments)
    .where(and(eq(billingDocuments.caseId, caseId), inArray(billingDocuments.status, [...ISSUED])));
  const finals = docs.filter((d) => d.type === "rechnung" || d.type === "schlussrechnung");
  return {
    offerSent: docs.some((d) => d.type === "angebot"),
    orderConfirmed: docs.some((d) => d.type === "auftragsbestaetigung"),
    partialInvoiced: docs.some((d) => d.type === "abschlagsrechnung"),
    finalInvoiced: finals.length > 0,
    finalPaid: finals.length > 0 && finals.every((d) => Number(d.paid) >= d.grossCents),
  };
}

/** Berechnet den Status neu, sofern er nicht manuell überschrieben wurde. */
export async function recomputeCaseStatus(tx: DbOrTx, caseId: string, actor: string) {
  const [kase] = await tx.select().from(cases).where(eq(cases.id, caseId));
  if (!kase || kase.statusOverridden) return;
  const derived = deriveCaseStatus(await loadCaseFacts(tx, caseId));
  if (!derived || derived === kase.status) return;
  const closedAt =
    derived === "abgeschlossen" ? new Date().toISOString().slice(0, 10) : kase.closedAt;
  await tx.update(cases).set({ status: derived, closedAt }).where(eq(cases.id, caseId));
  await recordEvents(tx, [
    {
      entityType: "case",
      entityId: caseId,
      type: "case.status_changed",
      actor,
      payload: { changes: { status: { from: kase.status, to: derived } }, manual: false },
    },
  ]);
}
