import { createHash } from "node:crypto";
import { z } from "@hono/zod-openapi";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import {
  bankTransactions,
  billingDocuments,
  cases,
  contacts,
  paymentAllocations,
} from "../../db/schema.js";
import { DomainError } from "../../lib/errors.js";
import { type EventInput, recordEvents } from "../../lib/events.js";
import { getSetting } from "../../lib/settings.js";
import { recomputeCaseStatus } from "../cases/status.js";
import { autoAllocations, type OpenItem, suggestAllocations } from "./matcher.js";

export const TransactionInput = z
  .object({
    externalId: z.string().min(1).nullish(),
    bookingDate: z.iso.date(),
    valueDate: z.iso.date().nullish(),
    amountCents: z
      .number()
      .int()
      .refine((v) => v !== 0, "Betrag darf nicht 0 sein"),
    currency: z.string().length(3).default("EUR"),
    counterpartyName: z.string().nullish(),
    counterpartyIban: z.string().nullish(),
    purpose: z.string().nullish(),
    reference: z.string().nullish(),
  })
  .openapi("BankTransactionInput");

export type TransactionInput = z.infer<typeof TransactionInput>;

/** Belegarten, die Forderungen begründen. */
export const RECEIVABLE_TYPES = ["rechnung", "abschlagsrechnung", "schlussrechnung"] as const;
const ISSUED = ["festgeschrieben", "versendet"] as const;

const paidExpr = sql<string>`coalesce((select sum(pa.amount_cents) from payment_allocations pa where pa.billing_document_id = "billing_documents"."id"), 0)`;

/** Offene Posten: festgeschriebene/versendete Rechnungen abzüglich zugeordneter Zahlungen. */
export async function loadReceivables(db: DbOrTx) {
  const rows = await db
    .select({
      billingDocumentId: billingDocuments.id,
      type: billingDocuments.type,
      number: billingDocuments.number,
      issueDate: billingDocuments.issueDate,
      dueDate: billingDocuments.dueDate,
      grossCents: billingDocuments.grossCents,
      prepaidCents: billingDocuments.prepaidCents,
      paidCents: paidExpr,
      contactId: billingDocuments.contactId,
      contactName: contacts.displayName,
      caseId: billingDocuments.caseId,
      caseNumber: cases.number,
    })
    .from(billingDocuments)
    .innerJoin(contacts, eq(contacts.id, billingDocuments.contactId))
    .leftJoin(cases, eq(cases.id, billingDocuments.caseId))
    .where(
      and(
        inArray(billingDocuments.type, [...RECEIVABLE_TYPES]),
        inArray(billingDocuments.status, [...ISSUED]),
      ),
    );
  return rows
    .map((r) => {
      const paid = Number(r.paidCents);
      // Forderung = Rechnungsbetrag abzüglich bereits abgerechneter Abschläge (Schlussrechnung)
      return { ...r, paidCents: paid, openCents: r.grossCents - r.prepaidCents - paid };
    })
    .filter((r) => r.openCents > 0);
}

/**
 * Doppelimport-Schutz: externe ID, sonst Hash der Umsatzdaten. Identische Umsätze innerhalb
 * einer Datei (z. B. zwei gleiche Zahlungen am selben Tag) werden über eine laufende Nummer
 * unterschieden, damit ein erneuter Import derselben Datei trotzdem erkannt wird.
 */
export function dedupeKeys(list: TransactionInput[]): string[] {
  const seen = new Map<string, number>();
  return list.map((t) => {
    if (t.externalId) return `id:${t.externalId}`;
    const base = createHash("sha256")
      .update(
        [
          t.bookingDate,
          t.amountCents,
          t.counterpartyIban ?? "",
          t.counterpartyName ?? "",
          t.purpose ?? "",
          t.reference ?? "",
        ].join("|"),
      )
      .digest("hex")
      .slice(0, 32);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `h:${base}:${n}`;
  });
}

export async function importTransactions(
  tx: DbOrTx,
  account: string,
  list: TransactionInput[],
  actor: string,
) {
  const keys = dedupeKeys(list);
  const inserted: string[] = [];
  for (const [i, t] of list.entries()) {
    const rows = await tx
      .insert(bankTransactions)
      .values({
        account,
        bookingDate: t.bookingDate,
        valueDate: t.valueDate ?? null,
        amountCents: t.amountCents,
        currency: t.currency,
        counterpartyName: t.counterpartyName ?? null,
        counterpartyIban: t.counterpartyIban ?? null,
        purpose: t.purpose ?? null,
        reference: t.reference ?? null,
        dedupeKey: keys[i] as string,
      })
      .onConflictDoNothing()
      .returning({ id: bankTransactions.id });
    if (rows[0]) inserted.push(rows[0].id);
  }
  let allocated = 0;
  for (const id of inserted) if (await matchTransaction(tx, id, actor)) allocated++;
  return {
    received: list.length,
    imported: inserted.length,
    duplicates: list.length - inserted.length,
    allocated,
  };
}

/** Ermittelt Vorschläge für einen offenen Umsatz und ordnet eindeutige Treffer automatisch zu. */
export async function matchTransaction(tx: DbOrTx, id: string, actor: string): Promise<boolean> {
  const [t] = await tx.select().from(bankTransactions).where(eq(bankTransactions.id, id));
  if (t?.status !== "offen") return false;
  const settings = await getSetting(tx, "bank");
  const items: OpenItem[] = (await loadReceivables(tx)).map((r) => ({
    billingDocumentId: r.billingDocumentId,
    number: r.number ?? "",
    openCents: r.openCents,
    contactName: r.contactName,
  }));
  const suggestions = suggestAllocations(t, items);
  const auto = autoAllocations(suggestions, settings.autoAllocateThreshold);
  await tx.update(bankTransactions).set({ suggestions }).where(eq(bankTransactions.id, id));
  if (auto.length === 0) return false;
  await applyAllocations(
    tx,
    id,
    auto.map((s) => ({
      billingDocumentId: s.billingDocumentId,
      amountCents: s.amountCents,
      confidence: s.score,
      reason: s.reason,
    })),
    "automatisch",
    actor,
  );
  return true;
}

interface AllocationInput {
  billingDocumentId: string;
  amountCents: number;
  confidence?: number;
  reason?: string;
}

/** Ersetzt die Zuordnungen eines Umsatzes; prüft Beträge gegen Umsatz und offene Posten. */
export async function applyAllocations(
  tx: DbOrTx,
  transactionId: string,
  allocations: AllocationInput[],
  source: "automatisch" | "manuell",
  actor: string,
) {
  // Umsatz sperren: parallele Zuordnungen (manuell/Abgleich) auf denselben Umsatz serialisieren
  const [locked] = await tx.execute<{ id: string }>(
    sql`SELECT id FROM bank_transactions WHERE id = ${transactionId} FOR UPDATE`,
  );
  if (!locked) throw new DomainError(404, "Umsatz nicht gefunden");
  const [t] = await tx
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, transactionId));
  if (!t) throw new DomainError(404, "Umsatz nicht gefunden");
  if (allocations.length > 0 && t.amountCents <= 0) {
    throw new DomainError(422, "Nur Zahlungseingänge können Rechnungen zugeordnet werden");
  }
  // Betroffene Rechnungen in fester Reihenfolge sperren (verhindert Überbuchung und Deadlocks)
  for (const docId of [...new Set(allocations.map((a) => a.billingDocumentId))].sort()) {
    await tx.execute(sql`SELECT id FROM billing_documents WHERE id = ${docId} FOR UPDATE`);
  }
  const previous = await tx
    .select()
    .from(paymentAllocations)
    .where(eq(paymentAllocations.transactionId, transactionId));
  await tx.delete(paymentAllocations).where(eq(paymentAllocations.transactionId, transactionId));

  const total = allocations.reduce((s, a) => s + a.amountCents, 0);
  if (allocations.some((a) => a.amountCents <= 0))
    throw new DomainError(422, "Beträge müssen positiv sein");
  if (allocations.length > 0 && total > t.amountCents) {
    throw new DomainError(422, "Zugeordnete Summe übersteigt den Umsatz");
  }
  if (allocations.length > 0) {
    const open = new Map(
      (await loadReceivables(tx)).map((r) => [r.billingDocumentId, r.openCents]),
    );
    for (const a of allocations) {
      const [doc] = await tx
        .select({
          id: billingDocuments.id,
          type: billingDocuments.type,
          status: billingDocuments.status,
        })
        .from(billingDocuments)
        .where(eq(billingDocuments.id, a.billingDocumentId));
      if (!doc || !(RECEIVABLE_TYPES as readonly string[]).includes(doc.type)) {
        throw new DomainError(422, "Zuordnung nur zu Rechnungen möglich");
      }
      if ((open.get(a.billingDocumentId) ?? 0) < a.amountCents) {
        throw new DomainError(422, "Betrag übersteigt den offenen Posten");
      }
    }
    await tx.insert(paymentAllocations).values(
      allocations.map((a) => ({
        transactionId,
        billingDocumentId: a.billingDocumentId,
        amountCents: a.amountCents,
        source,
        confidence: a.confidence === undefined ? null : String(a.confidence),
        reason: a.reason ?? null,
      })),
    );
  }
  const status = total === 0 ? "offen" : total === t.amountCents ? "zugeordnet" : "teilweise";
  await tx.update(bankTransactions).set({ status }).where(eq(bankTransactions.id, transactionId));

  const docIds = [
    ...new Set([
      ...previous.map((p) => p.billingDocumentId),
      ...allocations.map((a) => a.billingDocumentId),
    ]),
  ];
  const events: EventInput[] = [
    {
      entityType: "bank_transaction",
      entityId: transactionId,
      type: "bank_transaction.allocated",
      actor,
      payload: {
        source,
        allocations: allocations.map((a) => ({
          billingDocumentId: a.billingDocumentId,
          amountCents: a.amountCents,
        })),
      },
    },
  ];
  await recordEvents(tx, events);
  await recomputeCasesForDocuments(tx, docIds, actor);
}

export async function recomputeCasesForDocuments(tx: DbOrTx, docIds: string[], actor: string) {
  if (docIds.length === 0) return;
  const rows = await tx
    .selectDistinct({ caseId: billingDocuments.caseId })
    .from(billingDocuments)
    .where(inArray(billingDocuments.id, docIds));
  for (const r of rows) if (r.caseId) await recomputeCaseStatus(tx, r.caseId, actor);
}

export async function ignoreTransaction(tx: DbOrTx, id: string, actor: string) {
  const removed = await tx
    .select({
      billingDocumentId: paymentAllocations.billingDocumentId,
      amountCents: paymentAllocations.amountCents,
    })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.transactionId, id));
  await applyAllocations(tx, id, [], "manuell", actor);
  await tx.update(bankTransactions).set({ status: "ignoriert" }).where(eq(bankTransactions.id, id));
  await recordEvents(tx, [
    {
      entityType: "bank_transaction",
      entityId: id,
      type: "bank_transaction.ignored",
      actor,
      payload: { removedAllocations: removed },
    },
  ]);
}

/** Offene Eingänge erneut abgleichen (z. B. nach neuen Rechnungen). */
export async function rematchTransactions(tx: DbOrTx, actor: string) {
  const open = await tx
    .select({ id: bankTransactions.id })
    .from(bankTransactions)
    .where(and(eq(bankTransactions.status, "offen"), sql`${bankTransactions.amountCents} > 0`));
  let allocated = 0;
  for (const t of open) if (await matchTransaction(tx, t.id, actor)) allocated++;
  return { checked: open.length, allocated };
}
