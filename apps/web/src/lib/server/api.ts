import { error, fail } from "@sveltejs/kit";
import createClient from "openapi-fetch";
import type { paths } from "$lib/api/schema";
import { webEnv } from "./env";

export type ApiClient = ReturnType<typeof createClient<paths>>;

let client: ApiClient | undefined;

/** Typisierter API-Client für Server-Code; das API-Token verlässt nie den Server. */
export function api(): ApiClient {
  if (client) return client;
  const env = webEnv();
  client = createClient<paths>({
    baseUrl: env.apiUrl,
    headers: { authorization: `Bearer ${env.apiToken}` },
  });
  return client;
}

interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Fehlermeldung einer API-Antwort in lesbarer Form. */
export function apiMessage(err: unknown, status?: number): string {
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; problems?: { path: string; message: string }[] };
    if (Array.isArray(e.problems) && e.problems.length > 0) {
      return e.problems.map((p) => (p.path ? `${p.path}: ${p.message}` : p.message)).join("; ");
    }
    if (typeof e.message === "string") return e.message;
  }
  if (status === 404) return "Nicht gefunden";
  return `Fehler der API${status ? ` (${status})` : ""}`;
}

/** Für Load-Funktionen: Daten liefern oder eine Fehlerseite auslösen. */
export function must<T>(result: ApiResult<T>): T {
  if (result.data === undefined || result.error !== undefined) {
    const status = result.response.status >= 400 ? result.response.status : 502;
    error(status, apiMessage(result.error, status));
  }
  return result.data;
}

/** Für Form-Actions: Fehler als `fail()` mit Meldung zurückgeben, sonst null. */
export function failed(result: { error?: unknown; response: Response }, values?: unknown) {
  if (result.error === undefined && result.response.ok) return null;
  const status = result.response.status >= 400 ? result.response.status : 502;
  return fail(status < 500 ? status : 502, {
    error: apiMessage(result.error, status),
    values,
  });
}

/** Roher API-Aufruf (für Uploads mit Nicht-JSON-Inhalt); `path` relativ zu /api/v1. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const env = webEnv();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${env.apiToken}`);
  return fetch(`${env.apiUrl}/api/v1/${path}`, { ...init, headers });
}

/** JSON-Antwort eines rohen Aufrufs auswerten wie `failed()`. */
export async function rawResult<T>(
  res: Response,
): Promise<{ data?: T; error?: unknown; response: Response }> {
  const body = await res.json().catch(() => null);
  return res.ok ? { data: body as T, response: res } : { error: body ?? {}, response: res };
}

/** Textdatei dekodieren: UTF-8, sonst Windows-1252 (übliche Kodierung von Bankexporten). */
export function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
