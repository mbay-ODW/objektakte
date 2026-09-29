<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { formatDate } from "$lib/format";
  import { CASE_STATUS_LABELS, CASE_STATUSES } from "$lib/labels";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const columns = $derived(
    CASE_STATUSES.map((status) => ({
      status,
      items: data.cases.filter((c) => c.status === status),
    })),
  );
  const query = (view: string) => {
    const p = new URLSearchParams();
    if (view === "board") p.set("ansicht", "board");
    if (data.filter.status && view !== "board") p.set("status", data.filter.status);
    if (data.filter.measureCode) p.set("leistungsart", data.filter.measureCode);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
</script>

<svelte:head><title>Vorgänge – objektakte</title></svelte:head>

<div class="spread">
  <h1>Vorgänge</h1>
  <div class="row">
    <nav class="row" aria-label="Ansicht">
      <a
        class="button small"
        href="/vorgaenge{query('liste')}"
        aria-current={data.view === "liste" ? "page" : undefined}>Liste</a
      >
      <a
        class="button small"
        href="/vorgaenge{query('board')}"
        aria-current={data.view === "board" ? "page" : undefined}>Board</a
      >
    </nav>
    <a class="button primary" href="/vorgaenge/neu">Neuer Vorgang</a>
  </div>
</div>

<form method="get" class="row filters">
  {#if data.view === "board"}<input type="hidden" name="ansicht" value="board" />{/if}
  {#if data.view === "liste"}
    <label
      >Status
      <select name="status" value={data.filter.status}>
        <option value="">alle</option>
        {#each CASE_STATUSES as s (s)}<option value={s}>{CASE_STATUS_LABELS[s]}</option>{/each}
      </select>
    </label>
  {/if}
  <label
    >Leistungsart
    <select name="leistungsart" value={data.filter.measureCode}>
      <option value="">alle</option>
      {#each data.measureTypes as m (m.code)}<option value={m.code}>{m.code} – {m.name}</option>{/each}
    </select>
  </label>
  <button type="submit" class="self-end">Filtern</button>
</form>

<FormError {form} />

{#if data.view === "board"}
  <div class="board" aria-label="Kanban-Board">
    {#each columns as col (col.status)}
      <section class="column" aria-labelledby="col-{col.status}">
        <h2 id="col-{col.status}">
          {CASE_STATUS_LABELS[col.status]} <span class="badge">{col.items.length}</span>
        </h2>
        {#each col.items as k (k.id)}
          <article class="card kcard" data-testid="board-card">
            <a href="/vorgaenge/{k.id}"><strong>{k.number}</strong></a>
            <div>{k.title}</div>
            <div class="small muted">{k.customerName}</div>
            <form method="post" action="?/status" use:enhance class="move">
              <input type="hidden" name="id" value={k.id} />
              <label class="visually-hidden" for="st-{k.id}">Status von {k.number}</label>
              <select id="st-{k.id}" name="status" value={k.status}>
                {#each CASE_STATUSES as s (s)}<option value={s}>{CASE_STATUS_LABELS[s]}</option>{/each}
              </select>
              <button type="submit" class="small">Verschieben</button>
            </form>
          </article>
        {/each}
      </section>
    {/each}
  </div>
{:else}
  <div class="card table-wrap">
    <table>
      <thead>
        <tr><th>Nummer</th><th>Titel</th><th>Kunde</th><th>Status</th><th>Eröffnet</th></tr>
      </thead>
      <tbody>
        {#each data.cases as k (k.id)}
          <tr>
            <td class="nowrap"><a href="/vorgaenge/{k.id}">{k.number}</a></td>
            <td>{k.title}</td>
            <td><a href="/kontakte/{k.customerId}">{k.customerName}</a></td>
            <td><StatusBadge status={k.status} /></td>
            <td class="nowrap">{formatDate(k.openedAt)}</td>
          </tr>
        {:else}
          <tr><td colspan="5" class="muted">Keine Vorgänge gefunden.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .filters {
    margin: 0.5rem 0 1rem;
    align-items: flex-end;
  }
  .filters label {
    min-width: 12rem;
  }
  a[aria-current="page"] {
    background: var(--primary-soft);
    border-color: var(--primary);
  }
  .board {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(15rem, 1fr);
    gap: 0.75rem;
    overflow-x: auto;
    padding-bottom: 0.5rem;
  }
  .column {
    background: var(--surface-2);
    border-radius: var(--radius);
    padding: 0.5rem;
    margin: 0;
    min-height: 8rem;
  }
  .column h2 {
    font-size: 0.95rem;
  }
  .kcard {
    padding: 0.6rem;
    margin-bottom: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .move {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.3rem;
  }
  .move select {
    min-height: 2rem;
    padding: 0.2rem;
  }
</style>
