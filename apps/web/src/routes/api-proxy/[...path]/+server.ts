import { error } from "@sveltejs/kit";
import { webEnv } from "$lib/server/env";
import { checkCsrf, PASSTHROUGH_RESPONSE_HEADERS, safeApiPath } from "$lib/server/proxy";
import type { RequestHandler } from "./$types";

/**
 * Leitet Browser-Aufrufe an `${API_URL}/api/v1/...` weiter und ergänzt dabei das API-Token.
 * Nur für angemeldete Sitzungen (siehe hooks.server.ts) und nur mit Same-Origin + Client-Header.
 */
const proxy: RequestHandler = async ({ request, params, url, locals }) => {
  if (!locals.authenticated) error(401, "Nicht angemeldet");
  const csrf = checkCsrf(request, url.origin);
  if (csrf) error(403, csrf);
  const path = safeApiPath(params.path);
  if (!path) error(400, "Ungültiger Pfad");

  const env = webEnv();
  const headers = new Headers({ authorization: `Bearer ${env.apiToken}` });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(`${env.apiUrl}/api/v1/${path}${url.search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
    });
  } catch {
    error(502, "API nicht erreichbar");
  }

  const out = new Headers();
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) out.set(name, v);
  }
  if (!out.has("cache-control")) out.set("cache-control", "no-store");
  const body = upstream.status === 204 || upstream.status === 304 ? null : upstream.body;
  return new Response(body, { status: upstream.status, headers: out });
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
