/** Sprachnotizen: bevorzugt WebM/Opus, Safari fällt auf MP4/AAC zurück. */

export const AUDIO_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
] as const;

export function pickAudioMimeType(
  isSupported: (type: string) => boolean = (t) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
): string | null {
  return AUDIO_CANDIDATES.find((t) => isSupported(t)) ?? null;
}

export interface Recording {
  stop(): Promise<Blob>;
  cancel(): void;
}

/** Startet eine Aufnahme über das Mikrofon. */
export async function startRecording(): Promise<Recording> {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Aufnahme wird von diesem Browser nicht unterstützt");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickAudioMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();
  const release = () => {
    for (const t of stream.getTracks()) t.stop();
  };
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          release();
          const type = (recorder.mimeType || mimeType || "audio/webm").split(";")[0] as string;
          resolve(new Blob(chunks, { type }));
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = release;
      recorder.stop();
    },
  };
}
