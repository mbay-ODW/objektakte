<script lang="ts">
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import Timeline from "$lib/components/Timeline.svelte";
  import { CHANNEL_KIND_LABELS } from "$lib/labels";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const c = $derived(data.contact);
</script>

<svelte:head><title>{c.displayName} – objektakte</title></svelte:head>

<div class="spread">
  <h1>{c.displayName}</h1>
  <div class="row">
    <a class="button" href="/kontakte/{c.id}/bearbeiten">Bearbeiten</a>
    <a class="button primary" href="/vorgaenge/neu?customerId={c.id}">Neuer Vorgang</a>
  </div>
</div>

<div class="grid">
  <section class="card">
    <h2>Stammdaten</h2>
    <dl class="facts">
      <dt>Art</dt>
      <dd>{c.kind === "organisation" ? "Organisation" : "Person"}</dd>
      {#if c.customerNumber}<dt>Kundennummer</dt><dd>{c.customerNumber}</dd>{/if}
      <dt>Anschrift</dt>
      <dd>
        {c.street ?? ""}<br />{[c.postalCode, c.city].filter(Boolean).join(" ")}
        {c.country !== "DE" ? c.country : ""}
      </dd>
      {#if c.leitwegId}<dt>Leitweg-ID</dt><dd class="mono">{c.leitwegId}</dd>{/if}
      {#if c.vatId}<dt>USt-IdNr.</dt><dd>{c.vatId}</dd>{/if}
      {#if c.notes}<dt>Notizen</dt><dd><pre class="body">{c.notes}</pre></dd>{/if}
    </dl>
  </section>

  <section class="card">
    <h2>Kanäle</h2>
    {#if c.channels.length === 0}
      <p class="muted">Keine Kanäle hinterlegt.</p>
    {:else}
      <ul class="plain">
        {#each c.channels as ch (ch.kind + ch.value)}
          <li>
            <span class="badge">{CHANNEL_KIND_LABELS[ch.kind] ?? ch.kind}</span>
            {#if ch.kind === "email"}<a href="mailto:{ch.value}">{ch.value}</a>{:else}{ch.value}{/if}
            {#if ch.label}<span class="muted small">({ch.label})</span>{/if}
            {#if ch.isPrimary}<span class="badge ok">primär</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<section class="card">
  <h2>Vorgänge</h2>
  {#if data.cases.length === 0}
    <p class="muted">Keine Vorgänge.</p>
  {:else}
    <ul class="plain">
      {#each data.cases as k (k.id)}
        <li class="spread">
          <a href="/vorgaenge/{k.id}">{k.number} – {k.title}</a>
          <StatusBadge status={k.status} />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card">
  <h2>Chronik</h2>
  <Timeline items={data.timeline} />
</section>
