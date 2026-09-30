<script lang="ts">
  import { formatDateTime } from "$lib/format";
  import type { VorOrtState } from "$lib/offline/vor-ort.svelte";

  let { app }: { app: VorOrtState } = $props();
  const q = $derived(app.queue);
</script>

<div class="syncbar" class:offline={!app.online} role="status" aria-live="polite">
  <span class="state">
    <span class="dot" aria-hidden="true"></span>
    {app.online ? "Online" : "Offline"}
  </span>
  <span data-testid="pending-count" data-pending={q.pending}>
    {#if q.pending === 0}
      Alles übertragen
    {:else}
      {q.pending} ausstehend{#if q.failed > 0}, {q.failed} fehlerhaft{/if}
    {/if}
  </span>
  {#if q.running}<span class="small">Synchronisiere …</span>{/if}
  <button
    type="button"
    class="small"
    onclick={() => app.sync(true)}
    disabled={q.running || !app.online || q.pending === 0}>Jetzt synchronisieren</button
  >
  {#if q.lastError}<span class="err small" data-testid="sync-error">{q.lastError}</span>{/if}
  {#if q.lastSyncAt && q.pending === 0}
    <span class="small muted">zuletzt {formatDateTime(new Date(q.lastSyncAt).toISOString())}</span>
  {/if}
</div>

<style>
  .syncbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    align-items: center;
    padding: 0.5rem 1rem;
    background: var(--ok-soft);
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .syncbar.offline {
    background: var(--warn-soft);
  }
  .state {
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--ok);
  }
  .offline .dot {
    background: var(--warn);
  }
  .err {
    color: var(--danger);
    flex-basis: 100%;
  }
</style>
