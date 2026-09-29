/**
 * Offline-Warteschlange für Schreibaufträge der Begehung.
 *
 * - Aufträge werden in IndexedDB gespeichert und streng in Einfügereihenfolge übertragen.
 * - Vorübergehende Fehler (Netz, 5xx) → exponentielles Backoff, Abbruch des Durchlaufs.
 * - Dauerhafte Fehler (4xx) → Auftrag wird markiert und blockiert weitere Aufträge derselben
 *   Begehung, bis er verworfen oder erneut versucht wird. Andere Begehungen laufen weiter.
 * - Alle API-Schreibzugriffe sind idempotent, Wiederholungen sind daher unkritisch.
 */
import type { VorOrtDb } from "./db";
import type { JobPayload, QueuedJob, SendOutcome } from "./types";

export type Sender = (payload: JobPayload) => Promise<SendOutcome>;

export interface QueueState {
  pending: number;
  failed: number;
  running: boolean;
  lastError: string | null;
  lastSyncAt: number | null;
  nextAttemptAt: number | null;
}

export interface QueueOptions {
  now?: () => number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Wird nach erfolgreicher Übertragung eines Auftrags aufgerufen. */
  onDone?: (payload: JobPayload, result: unknown) => Promise<void> | void;
}

export interface FlushResult {
  sent: number;
  remaining: number;
  error: string | null;
}

/** Wartezeit nach dem n-ten Fehlversuch: base · 2^(n-1), gedeckelt. */
export function backoffDelay(attempts: number, baseDelayMs: number, maxDelayMs: number): number {
  if (attempts <= 0) return 0;
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (attempts - 1));
}

export class SyncQueue {
  private readonly now: () => number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly onDone?: QueueOptions["onDone"];
  private running: Promise<FlushResult> | null = null;
  private listeners = new Set<(s: QueueState) => void>();
  private snapshot: QueueState = {
    pending: 0,
    failed: 0,
    running: false,
    lastError: null,
    lastSyncAt: null,
    nextAttemptAt: null,
  };

  constructor(
    private readonly db: VorOrtDb,
    private readonly send: Sender,
    options: QueueOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.baseDelayMs = options.baseDelayMs ?? 2_000;
    this.maxDelayMs = options.maxDelayMs ?? 5 * 60_000;
    this.onDone = options.onDone;
  }

  get state(): QueueState {
    return this.snapshot;
  }

  subscribe(listener: (s: QueueState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private async publish(patch: Partial<QueueState> = {}) {
    const jobs = await this.jobs();
    const failed = jobs.filter((j) => j.failed);
    const waiting = jobs.filter((j) => !j.failed);
    const lastError = patch.lastError !== undefined ? patch.lastError : this.snapshot.lastError;
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      pending: jobs.length,
      failed: failed.length,
      lastError: jobs.length === 0 ? null : lastError,
      // Aufträge laufen strikt in Reihenfolge: maßgeblich ist der erste wartende.
      nextAttemptAt: waiting[0]?.nextAttemptAt || null,
    };
    for (const l of this.listeners) l(this.snapshot);
  }

  /** Zustand neu aus der Datenbank lesen (z. B. nach dem Start). */
  refresh(): Promise<void> {
    return this.publish();
  }

  async enqueue(payload: JobPayload): Promise<number> {
    const job: QueuedJob = {
      payload,
      createdAt: this.now(),
      attempts: 0,
      lastError: null,
      nextAttemptAt: 0,
      failed: false,
    };
    const seq = await this.db.add("jobs", job);
    await this.publish();
    return seq;
  }

  /** Alle Aufträge in Übertragungsreihenfolge. */
  async jobs(): Promise<QueuedJob[]> {
    return this.db.getAll("jobs");
  }

  async pendingCount(inspectionId?: string): Promise<number> {
    if (!inspectionId) return this.db.count("jobs");
    return this.db.countFromIndex("jobs", "byInspection", inspectionId);
  }

  /** Einen dauerhaft fehlgeschlagenen Auftrag verwerfen. */
  async discard(seq: number): Promise<void> {
    await this.db.delete("jobs", seq);
    await this.publish();
  }

  /** Fehlgeschlagene Aufträge wieder freigeben (z. B. nach Korrektur). */
  async retryFailed(): Promise<void> {
    const tx = this.db.transaction("jobs", "readwrite");
    for (const job of await tx.store.getAll()) {
      if (job.failed || job.attempts > 0) {
        await tx.store.put({ ...job, failed: false, nextAttemptAt: 0 });
      }
    }
    await tx.done;
    await this.publish();
  }

  /**
   * Überträgt fällige Aufträge in Reihenfolge. `force` ignoriert Backoff-Wartezeiten
   * (manuelles „Jetzt synchronisieren“). Parallele Aufrufe teilen sich einen Durchlauf.
   */
  flush(options: { force?: boolean } = {}): Promise<FlushResult> {
    if (this.running) return this.running;
    this.running = this.run(options.force ?? false).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(force: boolean): Promise<FlushResult> {
    await this.publish({ running: true });
    let sent = 0;
    let error: string | null = null;
    const blocked = new Set<string>();
    try {
      for (const job of await this.jobs()) {
        const inspectionId = job.payload.inspectionId;
        if (job.failed) {
          blocked.add(inspectionId);
          error ??= job.lastError;
          continue;
        }
        if (blocked.has(inspectionId)) continue;
        if (!force && job.nextAttemptAt > this.now()) {
          // Auf Backoff warten; spätere Aufträge dürfen nicht vorziehen.
          break;
        }
        let outcome: SendOutcome;
        try {
          outcome = await this.send(job.payload);
        } catch (err) {
          outcome = { ok: false, retry: true, error: errorText(err) };
        }
        if (outcome.ok) {
          await this.db.delete("jobs", job.seq as number);
          sent++;
          await this.onDone?.(job.payload, outcome.result);
          continue;
        }
        const attempts = job.attempts + 1;
        error = outcome.error;
        if (outcome.retry) {
          await this.db.put("jobs", {
            ...job,
            attempts,
            lastError: outcome.error,
            nextAttemptAt: this.now() + backoffDelay(attempts, this.baseDelayMs, this.maxDelayMs),
          });
          break;
        }
        await this.db.put("jobs", { ...job, attempts, lastError: outcome.error, failed: true });
        blocked.add(inspectionId);
      }
    } finally {
      await this.publish({
        running: false,
        lastError: error,
        lastSyncAt: sent > 0 || error === null ? this.now() : this.snapshot.lastSyncAt,
      });
    }
    return { sent, remaining: await this.db.count("jobs"), error };
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
