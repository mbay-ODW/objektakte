import { describe, expect, it } from "vitest";
import { pickAudioMimeType } from "./audio";
import { fitWithin } from "./image";
import { baseMimeType, mediaFilename } from "./service";

describe("Fotos", () => {
  it("verkleinert auf die längste Kante und behält das Seitenverhältnis", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10000, 10)).toEqual({ width: 1600, height: 2 });
  });
});

describe("Sprachnotizen", () => {
  it("bevorzugt WebM und fällt auf MP4 zurück", () => {
    expect(pickAudioMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickAudioMimeType((t) => t.startsWith("audio/mp4"))).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(pickAudioMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickAudioMimeType(() => false)).toBeNull();
  });

  it("normalisiert MIME-Typen und Dateinamen", () => {
    expect(baseMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(baseMimeType("")).toBe("application/octet-stream");
    expect(mediaFilename("audio", "abc", "audio/mp4")).toBe("audio-abc.m4a");
    expect(mediaFilename("foto", "abc", "image/jpeg")).toBe("foto-abc.jpg");
  });
});
