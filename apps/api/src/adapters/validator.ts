/** Prüfung von E-Rechnungen durch einen externen Validator (Mustang-Sidecar, siehe /validator). */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  validator: string;
}

export interface EInvoiceValidator {
  validate(bytes: Uint8Array): Promise<ValidationResult>;
}

function decodeEntities(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Liest einen Mustang-Prüfbericht aus. */
export function parseMustangReport(report: string): Omit<ValidationResult, "validator"> {
  const grab = (tag: string) =>
    [...report.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) =>
      decodeEntities((m[1] ?? "").replace(/\s+/g, " ").trim()),
    );
  const statuses = [...report.matchAll(/<summary status="(\w+)"\s*\/>/g)].map((m) => m[1]);
  const valid = statuses.length > 0 && statuses.every((s) => s === "valid");
  return { valid, errors: grab("error"), warnings: grab("warning") };
}

export class HttpEInvoiceValidator implements EInvoiceValidator {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async validate(bytes: Uint8Array): Promise<ValidationResult> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/validate`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Validator ${res.status}: ${await res.text()}`);
    const report = await res.text();
    const parsed = parseMustangReport(report);
    const header = res.headers.get("x-validation-status");
    return { ...parsed, valid: parsed.valid && header !== "invalid", validator: "mustang" };
  }
}
