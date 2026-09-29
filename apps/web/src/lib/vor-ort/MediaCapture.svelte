<script lang="ts">
  import { startRecording, type Recording } from "$lib/offline/audio";
  import { compressImage } from "$lib/offline/image";

  let {
    label,
    onphoto,
    onaudio,
    disabled = false,
  }: {
    label: string;
    onphoto: (blob: Blob) => Promise<void>;
    onaudio: (blob: Blob) => Promise<void>;
    disabled?: boolean;
  } = $props();

  const uid = $props.id();
  let busy = $state(false);
  let error = $state<string | null>(null);
  let recording = $state<Recording | null>(null);
  let seconds = $state(0);
  let tick: ReturnType<typeof setInterval> | null = null;

  async function onFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    busy = true;
    error = null;
    try {
      for (const f of files) {
        let blob: Blob;
        try {
          blob = await compressImage(f);
        } catch {
          // Nicht dekodierbare Formate (z. B. HEIC ohne Unterstützung) unverändert übernehmen.
          blob = f;
        }
        await onphoto(blob);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      input.value = "";
      busy = false;
    }
  }

  async function toggleRecording() {
    error = null;
    if (recording) {
      const r = recording;
      recording = null;
      if (tick) clearInterval(tick);
      busy = true;
      try {
        await onaudio(await r.stop());
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        busy = false;
      }
      return;
    }
    try {
      recording = await startRecording();
      seconds = 0;
      tick = setInterval(() => (seconds += 1), 1000);
    } catch (err) {
      error = err instanceof Error ? err.message : "Mikrofon nicht verfügbar";
    }
  }

  function cancelRecording() {
    recording?.cancel();
    recording = null;
    if (tick) clearInterval(tick);
  }
</script>

<div class="capture row">
  <label class="button" class:disabled={disabled || busy} for="photo-{uid}">Foto aufnehmen</label>
  <input
    id="photo-{uid}"
    class="visually-hidden"
    type="file"
    accept="image/*"
    capture="environment"
    multiple
    aria-label="Foto aufnehmen: {label}"
    disabled={disabled || busy}
    onchange={onFiles}
  />
  <button type="button" onclick={toggleRecording} disabled={disabled || (busy && !recording)} aria-pressed={!!recording}>
    {#if recording}Stopp und speichern ({seconds} s){:else}Sprachnotiz{/if}
  </button>
  {#if recording}<button type="button" class="small" onclick={cancelRecording}>Verwerfen</button>{/if}
  {#if busy}<span class="small muted">Speichere …</span>{/if}
  {#if error}<span class="small error">{error}</span>{/if}
</div>

<style>
  .capture label.button {
    cursor: pointer;
  }
  .capture label.disabled {
    opacity: 0.55;
    pointer-events: none;
  }
</style>
