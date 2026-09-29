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
  | "incoming_invoice";

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
