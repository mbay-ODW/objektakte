<script lang="ts">
  import BillingStatusBadge from "$lib/components/BillingStatusBadge.svelte";
  import SearchPicker from "$lib/components/SearchPicker.svelte";
  import { formatCents, formatDate } from "$lib/format";
  import { BILLING_STATUS_LABELS, BILLING_STATUSES, BILLING_TYPE_LABELS, BILLING_TYPES } from "$lib/labels";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  // svelte-ignore state_referenced_locally
  let contactId = $state(data.filter.contactId);
  // svelte-ignore state_referenced_locally
  let caseId = $state(data.filter.caseId);
  const sum = $derived(data.docs.reduce((s, d) => s + d.grossCents, 0));
</script>

<svelte:head><title>Belege – objektakte</title></svelte:head>

<div class="spread">
  <h1>Belege</h1>
  <a class="button primary" href="/belege/neu">Neuer Beleg</a>
</div>

<form method="get" class="card filters">
  <label
    >Art
    <select name="art" value={data.filter.type}>
      <option value="">alle</option>
      {#each BILLING_TYPES as t (t)}<option value={t}>{BILLING_TYPE_LABELS[t]}</option>{/each}
    </select>
  </label>
  <label
    >Status
    <select name="status" value={data.filter.status}>
      <option value="">alle</option>
      {#each BILLING_STATUSES as s (s)}<option value={s}>{BILLING_STATUS_LABELS[s]}</option>{/each}
    </select>
  </label>
  <SearchPicker name="kontakt" label="Kunde" options={data.contacts} bind:value={contactId} />
  <SearchPicker name="vorgang" label="Vorgang" options={data.cases} bind:value={caseId} />
  <div class="row actions">
    <button type="submit">Filtern</button>
    <a href="/belege">Zurücksetzen</a>
  </div>
</form>

<div class="card table-wrap">
  <table>
    <thead>
      <tr><th>Nummer</th><th>Art</th><th>Kunde</th><th>Datum</th><th>Fällig</th><th class="num">Brutto</th><th>Status</th></tr>
    </thead>
    <tbody>
      {#each data.docs as d (d.id)}
        <tr>
          <td class="nowrap"><a href="/belege/{d.id}">{d.number ?? "Entwurf"}</a></td>
          <td>{BILLING_TYPE_LABELS[d.type]}</td>
          <td><a href="/kontakte/{d.contactId}">{d.contactName}</a></td>
          <td class="nowrap">{formatDate(d.issueDate)}</td>
          <td class="nowrap">{formatDate(d.dueDate)}</td>
          <td class="num nowrap">{formatCents(d.grossCents)}</td>
          <td><BillingStatusBadge status={d.status} /></td>
        </tr>
      {:else}
        <tr><td colspan="7" class="muted">Keine Belege gefunden.</td></tr>
      {/each}
    </tbody>
    {#if data.docs.length > 0}
      <tfoot>
        <tr><td colspan="5">{data.docs.length} Belege</td><td class="num nowrap">{formatCents(sum)}</td><td></td></tr>
      </tfoot>
    {/if}
  </table>
</div>

<style>
  .filters {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
    align-items: end;
    margin: 0.5rem 0 1rem;
  }
</style>
