import { createHmac } from "node:crypto";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { events, webhookSubscriptions } from "../../db/schema.js";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface DispatchOptions {
  fetch?: FetchLike;
  now?: Date;
  batchSize?: number;
  timeoutMs?: number;
}

/** Prüft, ob ein Ereignistyp auf ein Muster passt ("*", exakt oder Präfix "case.*"). */
export function matchesType(type: string, patterns: string[]): boolean {
  return patterns.some(
    (p) => p === "*" || p === type || (p.endsWith(".*") && type.startsWith(p.slice(0, -1))),
  );
}

export function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Stellt für jedes aktive Abonnement die nächsten Ereignisse nach seinem Cursor zu.
 * Zustellung „at least once“: Der Cursor wird erst nach einer 2xx-Antwort weitergesetzt;
 * Empfänger deduplizieren über die Ereignis-ID. Bei Fehlern exponentieller Backoff (max. 1 h).
 */
export async function dispatchWebhooks(db: Database, opts: DispatchOptions = {}) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? new Date();
  const batchSize = opts.batchSize ?? 100;
  const subs = await db
    .select()
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.active, true),
        or(
          isNull(webhookSubscriptions.nextAttemptAt),
          lte(webhookSubscriptions.nextAttemptAt, now),
        ),
      ),
    );

  const results: { subscriptionId: string; delivered: number; error?: string }[] = [];
  for (const sub of subs) {
    const candidates = await db
      .select()
      .from(events)
      .where(gt(events.id, sub.lastEventId))
      .orderBy(asc(events.id))
      .limit(batchSize);
    if (candidates.length === 0) continue;
    const lastId = candidates[candidates.length - 1]?.id ?? sub.lastEventId;
    const matching = candidates.filter((e) => matchesType(e.type, sub.eventTypes));
    if (matching.length === 0) {
      // Nichts Relevantes: nur Cursor weiterschieben.
      await db
        .update(webhookSubscriptions)
        .set({ lastEventId: lastId })
        .where(eq(webhookSubscriptions.id, sub.id));
      continue;
    }
    const body = JSON.stringify({
      subscriptionId: sub.id,
      events: matching.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        type: e.type,
        entityType: e.entityType,
        entityId: e.entityId,
        actor: e.actor,
        payload: e.payload,
      })),
    });
    let error: string | undefined;
    try {
      const res = await doFetch(sub.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-objektakte-signature": sign(sub.secret, body),
          "x-objektakte-delivery": String(lastId),
        },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (error) {
      const failures = sub.failures + 1;
      const delayMs = Math.min(2 ** failures * 15_000, 3_600_000);
      await db
        .update(webhookSubscriptions)
        .set({ failures, lastError: error, nextAttemptAt: new Date(now.getTime() + delayMs) })
        .where(eq(webhookSubscriptions.id, sub.id));
      results.push({ subscriptionId: sub.id, delivered: 0, error });
    } else {
      await db
        .update(webhookSubscriptions)
        .set({ lastEventId: lastId, failures: 0, lastError: null, nextAttemptAt: null })
        .where(eq(webhookSubscriptions.id, sub.id));
      results.push({ subscriptionId: sub.id, delivered: matching.length });
    }
  }
  return results;
}

/** Startet den periodischen Versand; liefert eine Stopp-Funktion. */
export function startWebhookDispatcher(db: Database, intervalMs = 5_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await dispatchWebhooks(db);
    } catch (err) {
      console.error("Webhook-Versand fehlgeschlagen", err);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
