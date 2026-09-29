<script lang="ts">
  import DeadlineBadge from "$lib/components/DeadlineBadge.svelte";
  import { formatDate } from "$lib/format";
  import { CASE_STATUS_LABELS, CASE_STATUSES } from "$lib/labels";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const groups = $derived(
    CASE_STATUSES.map((status) => ({
      status,
      items: data.cases.filter((c) => c.status === status),
    })),
  );
  const sections = $derived([
    { key: "overdue", title: "Überfällig", items: data.digest.overdue },
    { key: "dueSoon", title: "Bald fällig (14 Tage)", items: data.digest.dueSoon },
    { key: "reminders", title: "Erinnerungen", items: data.digest.reminders },
  ]);
</script>

<svelte:head><title>Übersicht – objektakte</title></svelte:head>

<h1>Übersicht</h1>

<div class="grid">
  <section class="card" aria-labelledby="fristen-h">
    <div class="spread">
      <h2 id="fristen-h">Fristen</h2>
      <a href="/fristen">Alle Fristen</a>
    </div>
    {#each sections as s (s.key)}
      <h3>{s.title} <span class="badge">{s.items.length}</span></h3>
      {#if s.items.length === 0}
        <p class="muted small">Keine.</p>
      {:else}
        <ul class="plain">
          {#each s.items as d (d.id)}
            <li>
              <div class="spread">
                <span>
                  {#if d.caseId}<a href="/vorgaenge/{d.caseId}">{d.caseNumber}</a> ·{/if}
                  {d.title}
                </span>
                <span class="row">
                  <span class="small muted">{formatDate(d.dueDate)}</span>
                  <DeadlineBadge
                    status={d.status}
                    dueDate={d.dueDate}
                    remindFrom={d.remindFrom}
                    today={data.digest.today}
                  />
                </span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  </section>

  <section class="card" aria-labelledby="inbox-h">
    <div class="spread">
      <h2 id="inbox-h">Inbox</h2>
      <a href="/inbox">Zur Inbox</a>
    </div>
    <dl class="facts">
      <dt>Offen</dt>
      <dd><strong data-testid="inbox-open">{data.inbox.open.length}</strong></dd>
      <dt>Automatisch, unbestätigt</dt>
      <dd><strong>{data.inbox.automatic.length}</strong></dd>
    </dl>
  </section>

  <section class="card" aria-labelledby="cases-h">
    <div class="spread">
      <h2 id="cases-h">Vorgänge nach Status</h2>
      <a href="/vorgaenge?ansicht=board">Board</a>
    </div>
    <ul class="plain">
      {#each groups as g (g.status)}
        <li class="spread">
          <a href="/vorgaenge?status={g.status}">{CASE_STATUS_LABELS[g.status]}</a>
          <span class="badge">{g.items.length}</span>
        </li>
      {/each}
    </ul>
  </section>
</div>
