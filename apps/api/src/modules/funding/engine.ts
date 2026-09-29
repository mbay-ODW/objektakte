import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { deadlineRules, deadlines, fundingCases, fundingPrograms } from "../../db/schema.js";
import { addDays, addMonths, type IsoDate } from "../../lib/dates.js";
import { type EventInput, recordEvents } from "../../lib/events.js";

type FundingCase = typeof fundingCases.$inferSelect;
type Rule = typeof deadlineRules.$inferSelect;
type Anchor = Rule["anchor"];

const anchorField: Record<Anchor, keyof FundingCase> = {
  tpb_created_at: "tpbCreatedAt",
  bza_created_at: "bzaCreatedAt",
  applied_at: "appliedAt",
  approved_at: "approvedAt",
  approval_valid_until: "approvalValidUntil",
  measure_completed_at: "measureCompletedAt",
  tpn_created_at: "tpnCreatedAt",
  proof_submitted_at: "proofSubmittedAt",
  isfp_date: "isfpDate",
};

/**
 * Liefert den Wert eines Ankerfelds. Das Ende des Bewilligungszeitraums wird, falls nicht
 * explizit gesetzt, aus Zusagedatum + Programm-Standardzeitraum berechnet.
 */
export function anchorValue(
  fc: FundingCase,
  anchor: Anchor,
  approvalPeriodMonths: number | null,
): IsoDate | null {
  if (anchor === "approval_valid_until" && !fc.approvalValidUntil) {
    return fc.approvedAt && approvalPeriodMonths
      ? addMonths(fc.approvedAt, approvalPeriodMonths)
      : null;
  }
  return (fc[anchorField[anchor]] as IsoDate | null) ?? null;
}

export interface PlannedDeadline {
  ruleId: string;
  title: string;
  dueDate: IsoDate;
  remindFrom: IsoDate;
  doneAt: IsoDate | null;
}

/** Reine Berechnung: welche Fristen ergeben sich aus Regeln und Förderfall? */
export function planDeadlines(
  fc: FundingCase,
  rules: Rule[],
  approvalPeriodMonths: number | null,
): PlannedDeadline[] {
  const planned: PlannedDeadline[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.programCode !== "*" && rule.programCode !== fc.programCode) continue;
    if (rule.guideline && rule.guideline !== fc.guideline) continue;
    const anchor = anchorValue(fc, rule.anchor, approvalPeriodMonths);
    if (!anchor) continue;
    const dueDate = addDays(addMonths(anchor, rule.offsetMonths), rule.offsetDays);
    planned.push({
      ruleId: rule.id,
      title: rule.title,
      dueDate,
      remindFrom: addDays(dueDate, -rule.leadDays),
      doneAt: rule.doneWhen ? anchorValue(fc, rule.doneWhen, approvalPeriodMonths) : null,
    });
  }
  return planned;
}

/**
 * Gleicht die regelbasierten Fristen eines Förderfalls mit dem aktuellen Stand ab.
 * Manuell angelegte Fristen (ohne Regel) bleiben unberührt; manuell erledigte oder verworfene
 * Regelfristen werden nicht wieder geöffnet, aber im Datum nachgeführt.
 */
export async function syncDeadlines(tx: DbOrTx, fundingCaseId: string, actor: string) {
  const [fc] = await tx.select().from(fundingCases).where(eq(fundingCases.id, fundingCaseId));
  if (!fc) return;
  const [program] = await tx
    .select()
    .from(fundingPrograms)
    .where(eq(fundingPrograms.code, fc.programCode));
  const rules = await tx
    .select()
    .from(deadlineRules)
    .where(
      and(
        eq(deadlineRules.active, true),
        or(eq(deadlineRules.programCode, "*"), eq(deadlineRules.programCode, fc.programCode)),
        or(isNull(deadlineRules.guideline), eq(deadlineRules.guideline, fc.guideline ?? "")),
      ),
    );
  const planned = planDeadlines(fc, rules, program?.approvalPeriodMonths ?? null);
  const existing = await tx
    .select()
    .from(deadlines)
    .where(eq(deadlines.fundingCaseId, fundingCaseId));
  const byRule = new Map(existing.filter((d) => d.ruleId).map((d) => [d.ruleId, d]));
  const events: EventInput[] = [];

  for (const p of planned) {
    const current = byRule.get(p.ruleId);
    byRule.delete(p.ruleId);
    // Manuell gesetzte Status (erledigt/verworfen) bleiben erhalten. Sonst gilt die Regel:
    // Erledigungsanker gesetzt → erledigt; entfällt er, wird eine regel-erledigte Frist wieder offen.
    let status: "offen" | "erledigt" | "verworfen" = current?.status ?? "offen";
    let completedAt = current?.completedAt ?? null;
    let completedByRule = current?.completedByRule ?? false;
    const manual = current !== undefined && current.status !== "offen" && !current.completedByRule;
    if (!manual && p.doneAt) {
      status = "erledigt";
      completedAt = p.doneAt;
      completedByRule = true;
    } else if (!manual && completedByRule) {
      status = "offen";
      completedAt = null;
      completedByRule = false;
    }
    if (!current) {
      const [row] = await tx
        .insert(deadlines)
        .values({
          caseId: fc.caseId,
          fundingCaseId,
          ruleId: p.ruleId,
          title: p.title,
          dueDate: p.dueDate,
          remindFrom: p.remindFrom,
          status,
          completedAt,
          completedByRule,
        })
        .returning({ id: deadlines.id });
      if (row) {
        events.push({
          entityType: "deadline",
          entityId: row.id,
          type: "deadline.created",
          actor,
          payload: { title: p.title, dueDate: p.dueDate, status },
        });
      }
      continue;
    }
    const changed =
      current.dueDate !== p.dueDate ||
      current.remindFrom !== p.remindFrom ||
      current.title !== p.title ||
      current.status !== status ||
      current.completedAt !== completedAt ||
      current.completedByRule !== completedByRule;
    if (changed) {
      await tx
        .update(deadlines)
        .set({
          title: p.title,
          dueDate: p.dueDate,
          remindFrom: p.remindFrom,
          status,
          completedAt,
          completedByRule,
        })
        .where(eq(deadlines.id, current.id));
      events.push({
        entityType: "deadline",
        entityId: current.id,
        type: "deadline.updated",
        actor,
        payload: { title: p.title, dueDate: p.dueDate, status },
      });
    }
  }

  // Regelfristen, deren Anker entfallen ist: offene und regel-erledigte löschen,
  // manuell erledigte/verworfene als Historie behalten.
  const obsolete = [...byRule.values()].filter((d) => d.status === "offen" || d.completedByRule);
  if (obsolete.length > 0) {
    await tx.delete(deadlines).where(
      inArray(
        deadlines.id,
        obsolete.map((d) => d.id),
      ),
    );
    for (const d of obsolete) {
      events.push({
        entityType: "deadline",
        entityId: d.id,
        type: "deadline.removed",
        actor,
        payload: { title: d.title },
      });
    }
  }
  await recordEvents(tx, events);
}

/** Nach einer Regeländerung alle betroffenen Förderfälle neu berechnen. */
export async function resyncAllDeadlines(tx: DbOrTx, programCode: string, actor: string) {
  const rows = await tx
    .select({ id: fundingCases.id })
    .from(fundingCases)
    .where(programCode === "*" ? undefined : eq(fundingCases.programCode, programCode));
  for (const r of rows) await syncDeadlines(tx, r.id, actor);
}
