<script lang="ts">
  import type { LocalMedia } from "$lib/offline/types";
  import type { VorOrtState } from "$lib/offline/vor-ort.svelte";
  import MediaThumb from "./MediaThumb.svelte";

  let { app, media }: { app: VorOrtState; media: LocalMedia[] } = $props();

  function status(m: LocalMedia): { text: string; tone: string } {
    if (app.isMediaPending(m.id)) return { text: "wartet auf Übertragung", tone: "warn" };
    if (m.kind === "audio") {
      switch (m.transcriptStatus) {
        case "ausstehend":
          return { text: "Transkription läuft", tone: "info" };
        case "fertig":
          return { text: "transkribiert", tone: "ok" };
        case "fehler":
          return { text: "Transkription fehlgeschlagen", tone: "danger" };
        default:
          return { text: "übertragen", tone: "ok" };
      }
    }
    return { text: "übertragen", tone: "ok" };
  }
</script>

{#if media.length > 0}
  <ul class="media">
    {#each media as m (m.id)}
      {@const s = status(m)}
      <li class:audio={m.kind === "audio"} data-testid="media-{m.kind}">
        <MediaThumb {app} media={m} />
        <span class="badge {s.tone}">{s.text}</span>
        {#if m.kind === "audio" && m.transcript}<p class="small transcript">{m.transcript}</p>{/if}
        {#if m.transcriptError}<p class="small error">{m.transcriptError}</p>{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .media {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    align-items: flex-start;
  }
  li.audio {
    flex-basis: 100%;
  }
  .transcript {
    margin: 0;
    background: var(--surface-2);
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
  }
</style>
