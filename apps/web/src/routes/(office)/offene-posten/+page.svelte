<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import { formatCents, formatDate } from "$lib/format";
  import { BILLING_TYPE_LABELS, type BillingType } from "$lib/labels";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const overdue = $derived(data.items.filter((r) => r.daysOverdue > 0));
  const overdueSum = $derived(overdue.reduce((s, r) => s + r.openCents, 0));
  let reminderFor = $state<string | null>(null);
</script>

<svelte:head><title>Offene Posten – objektakte</title></svelte:head>

<h1>Offene Posten</h1>

<div class="grid kpis">
  <div class="card"><div class="small muted">Offen gesamt</div><div class="kpi" data-testid="open-total">{formatCents(data.totalOpenCents)}</div></div>
  <div class="card"><div class="small muted">Überfällig</div><div class="kpi danger-text">{overdue.length} · {formatCents(overdueSum)}</div></div>
</div>

<form method="get" class="row filters">
  <label class="inline"><input type="checkbox" name="ueberfaellig" value="1" checked={data.overdueOnly} /> nur überfällige</label>
  <button type="submit" class="small">Anwenden</button>
</form>

<FormError {form} />
{#if form && "done" in form}
  <p class="success" role="status">
    {form.done} {#if form.reminderId}<a href="/belege/{form.reminderId}">Öffnen</a>{/if}
  </p>
{/if}

<div class="card table-wrap">
  <table>
    <thead>
      <tr><th>Beleg</th><th>Kunde</th><th>Vorgang</th><th>Fällig</th><th class="num">Brutto</th><th class="num">Bezahlt</th><th class="num">Offen</th><th></th></tr>
    </thead>
    <tbody>
      {#each data.items as r (r.billingDocumentId)}
        <tr class:overdue={r.daysOverdue > 0} data-testid="receivable">
          <td class="nowrap">
            <a href="/belege/{r.billingDocumentId}">{r.number}</a>
            <div class="small muted">{BILLING_TYPE_LABELS[r.type as BillingType] ?? r.type}</div>
          </td>
          <td><a href="/kontakte/{r.contactId}">{r.contactName}</a></td>
          <td>{#if r.caseId}<a href="/vorgaenge/{r.caseId}">{r.caseNumber}</a>{/if}</td>
          <td class="nowrap">
            {formatDate(r.dueDate)}
            {#if r.daysOverdue > 0}<div><span class="badge danger">{r.daysOverdue} Tage überfällig</span></div>{/if}
          </td>
          <td class="num nowrap">{formatCents(r.grossCents)}</td>
          <td class="num nowrap">{formatCents(r.paidCents)}</td>
          <td class="num nowrap"><strong>{formatCents(r.openCents)}</strong></td>
          <td>
            <button type="button" class="small" onclick={() => (reminderFor = reminderFor === r.billingDocumentId ? null : r.billingDocumentId)}>
              Erinnern
            </button>
          </td>
        </tr>
        {#if reminderFor === r.billingDocumentId}
          <tr>
            <td colspan="8">
              <form
                method="post"
                action="?/reminder"
                class="row reminder"
                use:enhance={() =>
                  async ({ update }) => {
                    await update();
                    reminderFor = null;
                  }}
              >
                <input type="hidden" name="billingDocumentId" value={r.billingDocumentId} />
                <label>Stufe
                  <select name="level">
                    <option value="1">1 – Zahlungserinnerung</option>
                    <option value="2">2 – Mahnung</option>
                    <option value="3">3 – letzte Mahnung</option>
                  </select>
                </label>
                <label>Gebühr (€) <input name="fee" inputmode="decimal" value="0,00" /></label>
                <label>Frist (Tage) <input name="dueDays" type="number" min="1" max="60" value="10" /></label>
                <button type="submit" class="primary small">Erzeugen und festschreiben</button>
              </form>
            </td>
          </tr>
        {/if}
      {:else}
        <tr><td colspan="8" class="muted" data-testid="no-receivables">Keine offenen Posten.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .kpis {
    margin-bottom: 1rem;
  }
  .kpi {
    font-size: 1.5rem;
    font-weight: 700;
  }
  .danger-text {
    color: var(--danger);
  }
  .filters {
    margin-bottom: 0.75rem;
  }
  tr.overdue td {
    background: var(--danger-soft);
  }
  .reminder {
    align-items: flex-end;
  }
  .reminder label {
    max-width: 14rem;
  }
</style>
