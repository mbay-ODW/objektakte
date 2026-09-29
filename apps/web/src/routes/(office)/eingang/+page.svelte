<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import { formatCents, formatDate, todayIso } from "$lib/format";
  import { INCOMING_STATUS_LABELS } from "$lib/labels";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const today = todayIso();
  const tone = (s: string) =>
    s === "bezahlt" ? "ok" : s === "geprueft" ? "info" : s === "abgelehnt" ? "" : "warn";
</script>

<svelte:head><title>Eingangsrechnungen – objektakte</title></svelte:head>

<h1>Eingangsrechnungen</h1>

<FormError {form} />
{#if form && "done" in form}<p class="success" role="status">{form.done}</p>{/if}

<section class="card">
  <h2>E-Rechnung hochladen</h2>
  <form method="post" action="?/upload" enctype="multipart/form-data" class="row upload" use:enhance>
    <label>Datei (XRechnung-XML oder ZUGFeRD-PDF)
      <input type="file" name="file" accept=".xml,.pdf,application/xml,text/xml,application/pdf" required />
    </label>
    <button type="submit" class="primary">Hochladen</button>
  </form>
  <p class="small muted">Nummer, Lieferant, Beträge, Fälligkeit und IBAN werden ausgelesen; die Originaldatei wird abgelegt.</p>
</section>

<form method="get" class="row filters">
  <label>Status
    <select name="status" value={data.filter.status}>
      <option value="">alle</option>
      {#each Object.entries(INCOMING_STATUS_LABELS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
    </select>
  </label>
  <button type="submit">Filtern</button>
</form>

<div class="card table-wrap">
  <table>
    <thead>
      <tr><th>Lieferant</th><th>Nummer</th><th>Datum</th><th>Fällig</th><th class="num">Zahlbetrag</th><th>IBAN</th><th>Status</th><th></th></tr>
    </thead>
    <tbody>
      {#each data.items as inv (inv.id)}
        <tr data-testid="incoming-invoice">
          <td>{inv.sellerName ?? "–"}{#if inv.sellerVatId}<div class="small muted">{inv.sellerVatId}</div>{/if}</td>
          <td class="nowrap">{inv.number}<div class="small muted">{inv.syntax.toUpperCase()}{inv.typeCode ? ` · ${inv.typeCode}` : ""}</div></td>
          <td class="nowrap">{formatDate(inv.issueDate)}</td>
          <td class="nowrap">
            {formatDate(inv.dueDate)}
            {#if inv.status === "offen" && inv.dueDate && inv.dueDate < today}<div><span class="badge danger">überfällig</span></div>{/if}
          </td>
          <td class="num nowrap">{formatCents(inv.payableCents ?? inv.grossCents)}</td>
          <td class="mono small">{inv.iban ?? ""}</td>
          <td><span class="badge {tone(inv.status)}">{INCOMING_STATUS_LABELS[inv.status]}</span></td>
          <td>
            <div class="row">
              {#if inv.documentId}<a class="button small" href="/dokumente/{inv.documentId}" target="_blank" rel="noopener">Original</a>{/if}
              <form method="post" action="?/status" use:enhance class="row">
                <input type="hidden" name="id" value={inv.id} />
                <label class="visually-hidden" for="st-{inv.id}">Status</label>
                <select id="st-{inv.id}" name="status" value={inv.status}>
                  {#each Object.entries(INCOMING_STATUS_LABELS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
                </select>
                <button type="submit" class="small">Setzen</button>
              </form>
            </div>
          </td>
        </tr>
      {:else}
        <tr><td colspan="8" class="muted">Keine Eingangsrechnungen.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .upload,
  .filters {
    align-items: flex-end;
  }
  .filters {
    margin: 1rem 0;
  }
  select {
    min-height: 2rem;
    padding: 0.2rem;
  }
</style>
