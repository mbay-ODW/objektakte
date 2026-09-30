/**
 * Einfache Begrenzung fehlgeschlagener Anmeldungen je Client (im Speicher, pro Prozess).
 * Nach `max` Fehlversuchen innerhalb von `windowMs` wird bis zum Ablauf des Fensters gesperrt.
 */
export interface RateLimiterOptions {
  max?: number;
  windowMs?: number;
  now?: () => number;
  /** Obergrenze der gemerkten Clients (Schutz gegen Speicherwachstum). */
  maxEntries?: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

export class LoginRateLimiter {
  readonly max: number;
  readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private entries = new Map<string, Entry>();

  constructor(options: RateLimiterOptions = {}) {
    this.max = options.max ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60_000;
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  private current(key: string): Entry | undefined {
    const e = this.entries.get(key);
    if (e && e.resetAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }

  /** Sekunden bis zur Freigabe, falls gesperrt; sonst 0. */
  retryAfter(key: string): number {
    const e = this.current(key);
    if (!e || e.count < this.max) return 0;
    return Math.max(1, Math.ceil((e.resetAt - this.now()) / 1000));
  }

  /** Fehlversuch zählen. */
  fail(key: string): void {
    const e = this.current(key);
    if (e) {
      e.count += 1;
      return;
    }
    if (this.entries.size >= this.maxEntries) this.prune();
    this.entries.set(key, { count: 1, resetAt: this.now() + this.windowMs });
  }

  /** Erfolgreiche Anmeldung setzt den Zähler zurück. */
  reset(key: string): void {
    this.entries.delete(key);
  }

  private prune() {
    const now = this.now();
    for (const [k, e] of this.entries) if (e.resetAt <= now) this.entries.delete(k);
    // Immer noch voll: älteste Einträge verwerfen.
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** Gemeinsame Instanz für das Login. */
export const loginLimiter = new LoginRateLimiter();

export function waitMessage(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return `Zu viele Fehlversuche. Bitte in ${minutes} ${minutes === 1 ? "Minute" : "Minuten"} erneut versuchen.`;
}
