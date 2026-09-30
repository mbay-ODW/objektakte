import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { caseStatus, cases, measureTypes } from "../../db/schema.js";
import { changes, defined } from "../../lib/diff.js";
import { DomainError } from "../../lib/errors.js";
import { recordEvents } from "../../lib/events.js";
import { nextNumber } from "../../lib/sequences.js";

export const CaseStatus = z.enum(caseStatus.enumValues);
const text = z.string().trim().min(1).nullish();
const isoDate = z.iso.date().nullish();

export const CaseCreate = z
  .object({
    /** Leer = automatisch aus dem Nummernkreis "case" (Präfix = Leistungsart). */
    number: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1),
    customerId: z.uuid(),
    objectId: z.uuid().nullish(),
    measureCode: text,
    status: CaseStatus.optional(),
    openedAt: isoDate,
    storagePath: text,
    notes: text,
  })
  .openapi("CaseCreate");

export const CasePatch = z
  .object({
    title: z.string().trim().min(1).optional(),
    customerId: z.uuid().optional(),
    objectId: z.uuid().nullish(),
    measureCode: text,
    /** Manuelles Setzen markiert den Status als überschrieben (keine automatische Ableitung). */
    status: CaseStatus.optional(),
    openedAt: isoDate,
    closedAt: isoDate,
    storagePath: text,
    notes: text,
  })
  .openapi("CasePatch");

async function assertMeasure(tx: DbOrTx, code: string | null | undefined) {
  if (!code) return;
  const [m] = await tx.select().from(measureTypes).where(eq(measureTypes.code, code));
  if (!m) throw new DomainError(422, `Unbekannte Leistungsart "${code}"`);
}

export async function createCase(
  tx: DbOrTx,
  input: z.infer<typeof CaseCreate>,
  actor: string,
): Promise<string> {
  await assertMeasure(tx, input.measureCode);
  const number =
    input.number ?? `${input.measureCode ?? "V"}-${(await nextNumber(tx, "case")).padded}`;
  const [row] = await tx
    .insert(cases)
    .values({
      number,
      title: input.title,
      customerId: input.customerId,
      objectId: input.objectId ?? null,
      measureCode: input.measureCode ?? null,
      status: input.status ?? "anfrage",
      openedAt: input.openedAt ?? new Date().toISOString().slice(0, 10),
      storagePath: input.storagePath ?? null,
      notes: input.notes ?? null,
    })
    .returning({ id: cases.id });
  if (!row) throw new Error("Vorgang konnte nicht angelegt werden");
  await recordEvents(tx, [
    {
      entityType: "case",
      entityId: row.id,
      type: "case.created",
      actor,
      payload: { number, title: input.title },
    },
  ]);
  return row.id;
}

export async function updateCase(
  tx: DbOrTx,
  id: string,
  patch: z.infer<typeof CasePatch>,
  actor: string,
) {
  const [before] = await tx.select().from(cases).where(eq(cases.id, id));
  if (!before) throw new DomainError(404, "Vorgang nicht gefunden");
  await assertMeasure(tx, patch.measureCode);
  const set: Partial<typeof cases.$inferInsert> = defined(patch);
  if (patch.status !== undefined && patch.status !== before.status) set.statusOverridden = true;
  const diff = changes(before, set);
  if (Object.keys(diff).length === 0) return;
  await tx.update(cases).set(set).where(eq(cases.id, id));
  const events = [
    {
      entityType: "case" as const,
      entityId: id,
      type: "case.updated",
      actor,
      payload: { changes: diff },
    },
  ];
  if (diff.status) {
    events.push({
      entityType: "case",
      entityId: id,
      type: "case.status_changed",
      actor,
      payload: { changes: { status: diff.status }, manual: true } as never,
    });
  }
  await recordEvents(tx, events);
}
