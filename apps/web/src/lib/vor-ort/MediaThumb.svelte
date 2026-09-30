<script lang="ts">
  import type { LocalMedia } from "$lib/offline/types";
  import type { VorOrtState } from "$lib/offline/vor-ort.svelte";

  let { app, media }: { app: VorOrtState; media: LocalMedia } = $props();
  let localUrl = $state<string | null>(null);

  $effect(() => {
    let url: string | null = null;
    let cancelled = false;
    void app.service?.mediaBlob(media.id).then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      localUrl = url;
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  });

  const src = $derived(localUrl ?? (media.documentId ? `/dokumente/${media.documentId}` : null));
</script>

{#if media.kind === "foto"}
  {#if src}
    <img {src} alt={media.caption ?? "Foto"} loading="lazy" />
  {:else}
    <div class="placeholder">Foto</div>
  {/if}
{:else if src}
  <audio controls preload="none" {src}></audio>
{/if}

<style>
  img,
  .placeholder {
    width: 6.5rem;
    height: 5rem;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .placeholder {
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: 0.8rem;
  }
  audio {
    width: 100%;
    max-width: 18rem;
  }
</style>
