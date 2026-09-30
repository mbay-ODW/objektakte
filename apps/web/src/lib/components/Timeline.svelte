<script lang="ts">
  import type { components } from "$lib/api/schema";
  import { formatDateTime } from "$lib/format";

  let { items }: { items: components["schemas"]["TimelineItem"][] } = $props();
</script>

{#if items.length === 0}
  <p class="muted">Noch keine Einträge.</p>
{:else}
  <ol class="timeline">
    {#each items as item (item.kind + item.refId)}
      <li class={item.kind}>
        <div class="spread">
          <strong>{item.title}</strong>
          <time class="small muted" datetime={item.at}>{formatDateTime(item.at)}</time>
        </div>
        {#if item.detail}<pre class="body small">{item.detail}</pre>{/if}
      </li>
    {/each}
  </ol>
{/if}

<style>
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0 0 0 1rem;
    border-left: 2px solid var(--border);
  }
  li {
    position: relative;
    padding: 0.35rem 0 0.75rem 0.5rem;
  }
  li::before {
    content: "";
    position: absolute;
    left: -1.4rem;
    top: 0.7rem;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--muted);
  }
  li.communication::before {
    background: var(--primary);
  }
</style>
