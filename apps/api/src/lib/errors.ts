import { z } from "@hono/zod-openapi";

/** Fachlicher Fehler mit HTTP-Status; wird zentral in eine JSON-Antwort übersetzt. */
export class DomainError extends Error {
  constructor(
    readonly status: 404 | 409 | 422 | 503,
    message: string,
  ) {
    super(message);
  }
}

export const ErrorResponse = z
  .object({ error: z.string(), message: z.string().optional() })
  .openapi("ErrorResponse");

export const errorCode = (status: number) =>
  status === 404
    ? "not_found"
    : status === 409
      ? "conflict"
      : status === 503
        ? "service_unavailable"
        : "unprocessable";

/** Stellt sicher, dass ein gerade geschriebener Datensatz wieder gelesen werden konnte. */
export function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new DomainError(404, `${what} nicht gefunden`);
  return value;
}
