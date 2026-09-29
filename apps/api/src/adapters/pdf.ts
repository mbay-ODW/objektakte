export interface PdfOptions {
  /** z. B. "PDF/A-3b" für E-Rechnungen */
  pdfa?: "PDF/A-1b" | "PDF/A-2b" | "PDF/A-3b";
}

export interface PdfRenderer {
  htmlToPdf(html: string, opts?: PdfOptions): Promise<Uint8Array>;
}

/** Gotenberg (Chromium) – https://gotenberg.dev */
export class GotenbergRenderer implements PdfRenderer {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async htmlToPdf(html: string, opts: PdfOptions = {}): Promise<Uint8Array> {
    const form = new FormData();
    form.append("files", new Blob([html], { type: "text/html" }), "index.html");
    form.append("printBackground", "true");
    form.append("preferCssPageSize", "true");
    if (opts.pdfa) form.append("pdfa", opts.pdfa);
    const res = await this.fetchImpl(
      `${this.baseUrl.replace(/\/$/, "")}/forms/chromium/convert/html`,
      { method: "POST", body: form },
    );
    if (!res.ok) throw new Error(`Gotenberg ${res.status}: ${await res.text()}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
