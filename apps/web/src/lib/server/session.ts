import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "oa_session";
/** Gültigkeit einer Sitzung: 30 Tage. */
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Erzeugt ein signiertes Sitzungstoken `v1.<ausgestellt ms>.<nonce>.<hmac>`. */
export function createSessionToken(secret: string, now = Date.now()): string {
  const payload = `v1.${now}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** Prüft Signatur (konstante Laufzeit) und Alter eines Sitzungstokens. */
export function verifySessionToken(
  secret: string,
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const [, issued, nonce, mac] = parts as [string, string, string, string];
  if (!constantTimeEqual(mac, sign(secret, `v1.${issued}.${nonce}`))) return false;
  const issuedAt = Number(issued);
  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000) return false;
  return now - issuedAt <= SESSION_MAX_AGE_S * 1000;
}

/** Zeichenketten in konstanter Laufzeit vergleichen (auch bei unterschiedlicher Länge). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
