<script lang="ts">
  import { enhance } from "$app/forms";
  import DeadlineBadge from "$lib/components/DeadlineBadge.svelte";
  import FormError from "$lib/components/FormError.svelte";
  import { formatDate } from "$lib/format";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const digest = $derived([
    { key: "overdue", title: "Überfällig", items: data.digest.overdue, tone: "danger" },
    { key: "dueSoon", title: `Fällig in ${data.filter.days} Tagen`, items: data.digest.dueSoon, tone: "warn" },
    { key: "reminders", title: "Erinnerungsphase", items: data.digest.reminders, tone: "info" },
  ]);
</script>

<svelte:head><title>Fristen – objektakte</title></svelte:head>

<h1>Fristen</h1>

<div class="grid digest">
  {#each digest as g (g.key)}
    <section class="card">
      <h2>{g.title} <span class="badge {g.tone}">{g.items.length}</span></h2>
      <ul class="plain small">
        {#each g.items as d (d.id)}
          <li>
            {#if d.caseId}<a href="/vorgaenge/{d.caseId}">{d.caseNumber}</a> ·{/if}
            {d.title} – {formatDate(d.dueDate)}
          </li>
        {:else}
          <li class="muted">Keine.</li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<form method="get" class="row filters">
  <label
    >Status
    <select name="status" value={data.filter.status}>
      <option value="alle">alle</option>
      <option value="offen">offen</option>
      <option value="erledigt">erledigt</option>
      <option value="verworfen">verworfen</option>
    </select>
  </label>
  <label>Fällig bis <input type="date" name="bis" value={data.filter.dueBefore} /></label>
  <label>Übersicht (Tage) <input type="number" name="tage" min="0" max="365" value={data.filter.days} /></label>
  <button type="submit">Filtern</button>
</form>

<FormError {form} />

<div class="card table-wrap">
  <table>
    <thead>
      <tr><th>Fällig</th><th>Frist</th><th>Vorgang</th><th>Status</th><th><span class="visually-hidden">Aktionen</span></th></tr>
    </thead>
    <tbody>
      {#each data.deadlines as d (d.id)}
        <tr>
          <td class="nowrap">{formatDate(d.dueDate)}</td>
          <td>{d.title}{#if d.note}<div class="small muted">{d.note}</div>{/if}</td>
          <td>{#if d.caseId}<a href="/vorgaenge/{d.caseId}">{d.caseNumber}</a>{/if}</td>
          <td><DeadlineBadge status={d.status} dueDate={d.dueDate} remindFrom={d.remindFrom} today={data.digest.today} /></td>
          <td>
            <form method="post" action="?/status" use:enhance class="row">
              <input type="hidden" name="deadlineId" value={d.id} />
              {#if d.status === "offen"}
                <button type="submit" name="status" value="erledigt" class="small">Erledigt</button>
                <button type="submit" name="status" value="verworfen" class="small">Verwerfen</button>
              {:else}
                <button type="submit" name="status" value="offen" class="small">Wieder öffnen</button>
              {/if}
            </form>
          </td>
        </tr>
      {:else}
        <tr><td colspan="5" class="muted">Keine Fristen.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<section class="card new">
  <h2>Wiedervorlage ohne Vorgang</h2>
  <form method="post" action="?/create" class="form-grid" use:enhance>
    <label class="full">Titel <input name="title" required /></label>
    <label>Fällig am <input type="date" name="dueDate" required /></label>
    <label>Erinnern ab <input type="date" name="remindFrom" /></label>
    <label class="full">Notiz <input name="note" /></label>
    <div><button type="submit" class="primary">Anlegen</button></div>
  </form>
</section>

<style>
  .digest {
    margin-bottom: 1rem;
  }
  .filters {
    align-items: flex-end;
    margin-bottom: 1rem;
  }
  .new {
    margin-top: 1rem;
  }
</style>
