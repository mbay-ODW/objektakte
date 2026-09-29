export interface Transcriber {
  transcribe(audio: Uint8Array, mimeType: string, filename: string): Promise<string>;
}

/**
 * OpenAI-kompatible Transkriptions-API (`POST /v1/audio/transcriptions`), wie sie gängige
 * selbst gehostete Whisper-Server anbieten (z. B. faster-whisper-server/speaches, LocalAI).
 */
export class OpenAiCompatibleTranscriber implements Transcriber {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
    private readonly language = "de",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(audio: Uint8Array, mimeType: string, filename: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(audio)], { type: mimeType }), filename);
    form.append("model", this.model);
    form.append("language", this.language);
    form.append("response_format", "json");
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/v1/audio/transcriptions`, {
      method: "POST",
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error(`Transkription ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { text?: string };
    if (typeof data.text !== "string") throw new Error("Transkription ohne Text");
    return data.text.trim();
  }
}
