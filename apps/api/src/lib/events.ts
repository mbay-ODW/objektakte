import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client.js";
import { events } from "../db/schema.js";

export type EntityType =
  | "contact"
  | "object"
  | "case"
  | "communication"
  | "document"
  | "billing_document"
  | "funding_case"
  | "deadline"
  | "deadline_rule"
  | "inspection"
  | "bank_transaction"
  | "incoming_invoice"
  | "setting";

export interface EventInput {
  entityType: EntityType;
  entityId: string;
  /** z. B. `case.created`, `case.imported`, `case.status_changed` */
  type: string;
  actor: string;
  payload?: Record<string, unknown>;
}

/** Schreibt Ereignisse ins append-only-Protokoll. Immer innerhalb der fachlichen Transaktion aufrufen. */
export async function recordEvents(tx: DbOrTx, input: EventInput[]) {
  if (input.length === 0) return;
  await tx.insert(events).values(
    input.map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
      type: e.type,
      actor: e.actor,
      payload: e.payload ?? {},
    })),
  );
}

/** Stabile Pseudo-ID für Ereignisse zu Einstellungen/Nummernkreisen (die keine UUID haben). */
export function settingEntityId(key: string): string {
  const h = createHash("sha1").update(`setting:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Bedingung „Ereignis ist sicher sichtbar und nichts davor kann noch auftauchen“:
 * IDs werden beim Einfügen vergeben, Transaktionen committen aber in anderer Reihenfolge.
 * Ein Cursor darf daher nur bis vor das erste Ereignis einer noch laufenden Transaktion
 * vorrücken (tx_id >= xmin des aktuellen Snapshots).
 */
export function settledAfter(afterId: number) {
  return sql`${events.id} > ${afterId} and ${events.id} < coalesce(
    (select min(e2.id) from events e2
      where e2.id > ${afterId} and e2.tx_id >= pg_snapshot_xmin(pg_current_snapshot())),
    9223372036854775807)`;
}
