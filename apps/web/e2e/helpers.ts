import { type APIRequestContext, expect, type Page, request } from "@playwright/test";
import { E2E } from "./env";

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passwort").fill(E2E.password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
}

/** Direkter API-Zugriff (mit Token) für Testvorbereitung und Prüfungen. */
export async function apiClient(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${E2E.apiUrl}/api/v1/`,
    extraHTTPHeaders: { authorization: `Bearer ${E2E.apiToken}` },
  });
}

export async function apiJson<T = unknown>(
  api: APIRequestContext,
  method: "get" | "post" | "put" | "patch",
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await api[method](path, data === undefined ? undefined : { data });
  expect(res.ok(), `${method.toUpperCase()} ${path}: ${res.status()} ${await res.text()}`).toBe(
    true,
  );
  return (await res.json()) as T;
}

/** Eindeutiges Suffix, damit Tests unabhängig voneinander bleiben. */
export const uniq = () => Math.random().toString(36).slice(2, 7);

/** Minimales gültiges PNG (einfarbig) für Foto-Uploads. */
export async function pngBuffer(width = 32, height = 24): Promise<Buffer> {
  const { deflateSync, crc32 } = await import("node:zlib");
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x5a)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
