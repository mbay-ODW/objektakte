/** Reaktiver Zustand der PWA „Vor Ort“ (Svelte-Runes) über dem framework-unabhängigen Dienst. */
import { openVorOrtDb } from "./db";
import type { QueueState } from "./queue";
import { CLIENT_HEADER, createFetchSender } from "./sender";
import { type ServerInspection, VorOrtService } from "./service";
import type { CachedObject, LocalInspection, QueuedJob } from "./types";

const AUTO_SYNC_MS = 5_000;

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api-proxy/${path}`, {
    headers: { [CLIENT_HEADER]: "1", accept: "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`Abruf fehlgeschlagen (${res.status})`);
  return (await res.json()) as T;
}

export class VorOrtState {
  service: VorOrtService | null = null;
  ready = $state(false);
  online = $state(true);
  queue = $state<QueueState>({
    pending: 0,
    failed: 0,
    running: false,
    lastError: null,
    lastSyncAt: null,
    nextAttemptAt: null,
  });
  jobs = $state<QueuedJob[]>([]);
  inspections = $state<LocalInspection[]>([]);
  objects = $state<CachedObject[]>([]);
  objectsCachedAt = $state<string | null>(null);
  message = $state<string | null>(null);

  private timer: ReturnType<typeof setInterval> | null = null;
  private cleanup: (() => void)[] = [];

  async init() {
    if (this.service) return;
    const db = await openVorOrtDb();
    const service = new VorOrtService(db, createFetchSender());
    this.service = service;
    this.cleanup.push(
      service.queue.subscribe((s) => {
        this.queue = { ...s };
        void this.loadJobs();
      }),
      service.onChange(() => void this.loadLocal()),
    );
    await service.queue.refresh();
    await this.loadLocal();

    this.online = navigator.onLine;
    const goOnline = () => {
      this.online = true;
      void this.sync(true);
      void this.refreshObjects();
    };
    const goOffline = () => {
      this.online = false;
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    this.cleanup.push(() => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    });
    this.timer = setInterval(() => this.autoSync(), AUTO_SYNC_MS);
    this.ready = true;
    if (this.online) {
      void this.refreshObjects();
      void this.sync(false);
    }
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    for (const c of this.cleanup) c();
    this.cleanup = [];
  }

  private async loadLocal() {
    if (!this.service) return;
    this.inspections = await this.service.inspections();
    this.objects = await this.service.objects();
    this.objectsCachedAt = await this.service.objectsCachedAt();
  }

  private async loadJobs() {
    if (!this.service) return;
    this.jobs = await this.service.queue.jobs();
  }

  private autoSync() {
    const q = this.queue;
    if (!this.online || q.running || q.pending === q.failed) return;
    if (q.nextAttemptAt && q.nextAttemptAt > Date.now()) return;
    void this.sync(false);
  }

  async sync(force: boolean) {
    if (!this.service) return;
    await this.service.queue.flush({ force });
  }

  /** Objektliste (inkl. Vorgänge je Objekt) für die Offline-Auswahl aktualisieren. */
  async refreshObjects() {
    if (!this.service) return;
    try {
      const [objects, cases] = await Promise.all([
        apiGet<{ items: Omit<CachedObject, "cases">[] }>("objects?limit=500"),
        apiGet<{
          items: {
            id: string;
            number: string;
            title: string;
            status: string;
            objectId: string | null;
          }[];
        }>("cases?limit=500"),
      ]);
      await this.service.cacheObjects(
        objects.items.map((o) => ({
          id: o.id,
          label: o.label,
          street: o.street,
          postalCode: o.postalCode,
          city: o.city,
          cases: cases.items
            .filter((c) => c.objectId === o.id)
            .map((c) => ({ id: c.id, number: c.number, title: c.title, status: c.status })),
        })),
      );
    } catch {
      // Offline oder Server nicht erreichbar: gepufferte Liste bleibt gültig.
    }
  }

  /** Serverstand einer Begehung holen (Transkripte, Protokoll). */
  async refreshInspection(id: string, objectLabel?: string): Promise<LocalInspection | null> {
    if (!this.service || !this.online) return null;
    try {
      const server = await apiGet<ServerInspection>(`inspections/${encodeURIComponent(id)}`);
      const label =
        objectLabel ?? this.objects.find((o) => o.id === server.objectId)?.label ?? undefined;
      return await this.service.mergeServer(server, label);
    } catch {
      return null;
    }
  }

  pendingFor(inspectionId: string): number {
    return this.jobs.filter((j) => j.payload.inspectionId === inspectionId).length;
  }

  isMediaPending(mediaId: string): boolean {
    return this.jobs.some((j) => j.payload.type === "putMedia" && j.payload.mediaId === mediaId);
  }
}
