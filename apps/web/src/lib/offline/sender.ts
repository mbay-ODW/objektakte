/** Überträgt Aufträge der Warteschlange über den API-Proxy der Web-App. */
import type { JobPayload, SendOutcome } from "./types";

export const CLIENT_HEADER = "x-objektakte-client";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export function createFetchSender(fetchFn: FetchFn = fetch, base = "/api-proxy") {
  const headers = { [CLIENT_HEADER]: "1" };
  const json = (body: unknown) => ({
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  function request(payload: JobPayload): { url: string; init: RequestInit } {
    const i = encodeURIComponent(payload.inspectionId);
    switch (payload.type) {
      case "putInspection":
        return { url: `${base}/inspections/${i}`, init: { method: "PUT", ...json(payload.body) } };
      case "putItem":
        return {
          url: `${base}/inspections/${i}/items/${encodeURIComponent(payload.itemId)}`,
          init: { method: "PUT", ...json(payload.body) },
        };
      case "deleteItem":
        return {
          url: `${base}/inspections/${i}/items/${encodeURIComponent(payload.itemId)}`,
          init: { method: "DELETE", headers },
        };
      case "putMedia": {
        const form = new FormData();
        form.set("file", payload.blob, payload.filename);
        form.set("kind", payload.meta.kind);
        if (payload.meta.itemId) form.set("itemId", payload.meta.itemId);
        if (payload.meta.caption) form.set("caption", payload.meta.caption);
        form.set("takenAt", payload.meta.takenAt);
        return {
          url: `${base}/inspections/${i}/media/${encodeURIComponent(payload.mediaId)}`,
          init: { method: "PUT", headers, body: form },
        };
      }
      case "finalize":
        return {
          url: `${base}/inspections/${i}/finalize`,
          init: { method: "POST", ...json({ endedAt: payload.endedAt }) },
        };
    }
  }

  return async function send(payload: JobPayload): Promise<SendOutcome> {
    const { url, init } = request(payload);
    let res: Response;
    try {
      res = await fetchFn(url, { ...init, credentials: "same-origin" });
    } catch {
      return { ok: false, retry: true, error: "Keine Verbindung zum Server" };
    }
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return { ok: true, result: body };
    // Wiederholter Abschluss nach verlorener Antwort: Begehung ist bereits abgeschlossen.
    if (payload.type === "finalize" && res.status === 409) return { ok: true, result: null };
    const message = describeError(res.status, body);
    return { ok: false, retry: isTransient(res.status), error: message };
  };
}

/** Vorübergehende Fehler werden wiederholt, fachliche (4xx) nicht. */
export function isTransient(status: number): boolean {
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

function describeError(status: number, body: unknown): string {
  if (status === 401) return "Nicht angemeldet – bitte neu anmelden";
  const b = body as { message?: string; problems?: { path: string; message: string }[] } | null;
  if (b?.problems?.length) return b.problems.map((p) => `${p.path}: ${p.message}`).join("; ");
  if (b?.message) return `${b.message} (${status})`;
  return `Serverfehler ${status}`;
}
