import { describe, expect, it } from "vitest";
import { GotenbergRenderer } from "../src/adapters/pdf.js";
import { LocalStorage, WebDavStorage } from "../src/adapters/storage.js";
import { OpenAiCompatibleTranscriber } from "../src/adapters/transcriber.js";

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

function recorder(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const call = {
      url: String(url),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body,
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("WebDavStorage", () => {
  it("legt Ordner an, lädt hoch und wieder herunter", async () => {
    const files = new Map<string, Uint8Array>();
    const { calls, fetchImpl } = recorder((c) => {
      if (c.method === "MKCOL")
        return new Response(null, { status: c.url.endsWith("/a") ? 405 : 201 });
      if (c.method === "PUT") {
        files.set(c.url, new Uint8Array(c.body as Buffer));
        return new Response(null, { status: 201 });
      }
      const f = files.get(c.url);
      return f ? new Response(Buffer.from(f)) : new Response(null, { status: 404 });
    });
    const dav = new WebDavStorage(
      "https://cloud.example.org/remote.php/dav/files/u/",
      "u",
      "pw",
      fetchImpl,
    );
    const stored = await dav.put("/a/b c/datei ä.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
    expect(stored).toEqual({ storage: "nextcloud", location: "/a/b c/datei ä.jpg" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "MKCOL https://cloud.example.org/remote.php/dav/files/u/a",
      "MKCOL https://cloud.example.org/remote.php/dav/files/u/a/b%20c",
      "PUT https://cloud.example.org/remote.php/dav/files/u/a/b%20c/datei%20%C3%A4.jpg",
    ]);
    expect(calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from("u:pw").toString("base64")}`);
    expect(Array.from(await dav.get(stored.location))).toEqual([1, 2, 3]);
  });

  it("verhindert Pfad-Traversal", async () => {
    const local = new LocalStorage("/tmp/objektakte-traversal");
    await expect(local.put("../../etc/passwd", new Uint8Array(), "text/plain")).rejects.toThrow(
      "Unzulässiger Pfad",
    );
    await expect(local.get("/a/../../x")).rejects.toThrow("Unzulässiger Pfad");
  });
});

describe("GotenbergRenderer", () => {
  it("sendet HTML und PDF/A-Option", async () => {
    let form: FormData | undefined;
    const { calls, fetchImpl } = recorder((c) => {
      form = c.body as FormData;
      return new Response("%PDF-1.7");
    });
    const pdf = await new GotenbergRenderer("http://gotenberg:3000/", fetchImpl).htmlToPdf(
      "<p>x</p>",
      {
        pdfa: "PDF/A-3b",
      },
    );
    expect(new TextDecoder().decode(pdf)).toBe("%PDF-1.7");
    expect(calls[0]?.url).toBe("http://gotenberg:3000/forms/chromium/convert/html");
    expect(form?.get("pdfa")).toBe("PDF/A-3b");
    expect((form?.get("files") as File | undefined)?.name).toBe("index.html");
  });
});

describe("OpenAiCompatibleTranscriber", () => {
  it("ruft /v1/audio/transcriptions mit Sprache und Modell auf", async () => {
    let form: FormData | undefined;
    const { calls, fetchImpl } = recorder((c) => {
      form = c.body as FormData;
      return Response.json({ text: " Fenster Holz, zweifach verglast. " });
    });
    const t = new OpenAiCompatibleTranscriber(
      "http://whisper:8000",
      "large-v3",
      "key",
      "de",
      fetchImpl,
    );
    expect(await t.transcribe(new Uint8Array(3), "audio/webm", "a.webm")).toBe(
      "Fenster Holz, zweifach verglast.",
    );
    expect(calls[0]?.url).toBe("http://whisper:8000/v1/audio/transcriptions");
    expect(calls[0]?.headers.authorization).toBe("Bearer key");
    expect(form?.get("language")).toBe("de");
    expect(form?.get("model")).toBe("large-v3");
  });
});
