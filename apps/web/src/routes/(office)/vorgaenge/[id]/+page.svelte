<script lang="ts">
  import { enhance } from "$app/forms";
  import BillingStatusBadge from "$lib/components/BillingStatusBadge.svelte";
  import CaseForm from "$lib/components/CaseForm.svelte";
  import DeadlineBadge from "$lib/components/DeadlineBadge.svelte";
  import FormError from "$lib/components/FormError.svelte";
  import FundingForm from "$lib/components/FundingForm.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import Timeline from "$lib/components/Timeline.svelte";
  import { keepValues } from "$lib/enhance";
  import { formatCents, formatDate, formatDateTime } from "$lib/format";
  import {
    BILLING_TYPE_LABELS,
    COMM_CHANNEL_LABELS,
    DIRECTION_LABELS,
    FUNDING_DATE_FIELDS,
  } from "$lib/labels";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const k = $derived(data.kase);
  const objectOptions = $derived(
    data.objects.map((o) => ({ id: o.id, label: o.label, hint: o.city })),
  );
  const objectLabel = $derived(data.objects.find((o) => o.id === k.objectId)?.label);
  const programName = (code: string) => data.programs.find((p) => p.code === code)?.name ?? code;
  const manualDeadlines = $derived(data.deadlines.filter((d) => !d.fundingCaseId));
  let showNewFunding = $state(false);

  const sections = [
    ["stammdaten", "Stammdaten"],
    ["foerderung", "Förderfälle"],
    ["fristen", "Fristen"],
    ["chronik", "Chronik"],
    ["nachrichten", "Nachrichten"],
    ["belege", "Belege"],
    ["dokumente", "Dokumente"],
    ["begehungen", "Begehungen"],
  ];
</script>

<svelte:head><title>{k.number} – objektakte</title></svelte:head>

<div class="spread">
  <div>
    <h1>{k.number} · {k.title}</h1>
    <div class="row head-meta">
      <StatusBadge status={k.status} />
      {#if k.statusOverridden}
        <span class="badge" title="Status manuell gesetzt">manuell</span>
        <form method="post" action="?/statusAuto" use:enhance class="inline-form">
          <button type="submit" class="link small">Status wieder ableiten</button>
        </form>
      {/if}
      <a href="/kontakte/{k.customerId}">{k.customerName}</a>
      {#if k.objectId}· <a href="/objekte/{k.objectId}">{objectLabel ?? "Objekt"}</a>{/if}
    </div>
  </div>
  {#if k.objectId}
    <a class="button primary" href="/vor-ort?objekt={k.objectId}&vorgang={k.id}">Begehung starten</a>
  {/if}
</div>

<nav class="subnav" aria-label="Abschnitte">
  {#each sections as [id, label] (id)}<a href="#{id}">{label}</a>{/each}
</nav>

<FormError {form} />
{#if form && "saved" in form}<p class="success" role="status">Gespeichert.</p>{/if}

<section id="stammdaten" class="card">
  <h2>Stammdaten</h2>
  <details>
    <summary>Bearbeiten</summary>
    <form method="post" action="?/update" class="stack edit" use:enhance={keepValues}>
      <CaseForm kase={k} measureTypes={data.measureTypes} objects={objectOptions} />
      <div><button type="submit" class="primary">Speichern</button></div>
    </form>
  </details>
  <dl class="facts">
    <dt>Leistungsart</dt>
    <dd>{k.measureCode ?? "–"}</dd>
    <dt>Eröffnet</dt>
    <dd>{formatDate(k.openedAt)}</dd>
    {#if k.closedAt}<dt>Abgeschlossen</dt><dd>{formatDate(k.closedAt)}</dd>{/if}
    {#if k.storagePath}<dt>Ablage</dt><dd class="mono small">{k.storagePath}</dd>{/if}
    {#if k.notes}<dt>Notizen</dt><dd><pre class="body">{k.notes}</pre></dd>{/if}
  </dl>
</section>

<section id="foerderung" class="card">
  <div class="spread">
    <h2>Förderfälle</h2>
    <button type="button" onclick={() => (showNewFunding = !showNewFunding)}>
      {showNewFunding ? "Abbrechen" : "Neuer Förderfall"}
    </button>
  </div>
  {#if showNewFunding}
    <form
      method="post"
      action="?/createFunding"
      class="stack new-funding"
      use:enhance={() =>
        async ({ result, update }) => {
          await update();
          if (result.type === "success") showNewFunding = false;
        }}
    >
      <h3>Neuer Förderfall</h3>
      <FundingForm programs={data.programs} />
      <div><button type="submit" class="primary">Förderfall anlegen</button></div>
    </form>
  {/if}
  {#each data.fundingCases as fc (fc.id)}
    <article class="funding" data-testid="funding-case">
      <h3>{programName(fc.programCode)}{#if fc.guideline} <span class="muted small">({fc.guideline})</span>{/if}</h3>
      <dl class="facts">
        {#if fc.applicationId}<dt>Antrags-ID</dt><dd>{fc.applicationId}</dd>{/if}
        {#if fc.tpbId}<dt>TPB-ID</dt><dd>{fc.tpbId}</dd>{/if}
        {#if fc.tpnId}<dt>TPN-ID</dt><dd>{fc.tpnId}</dd>{/if}
        {#each FUNDING_DATE_FIELDS as [field, label] (field)}
          {#if fc[field]}<dt>{label}</dt><dd>{formatDate(fc[field])}</dd>{/if}
        {/each}
        {#if fc.eligibleCostsCents != null}<dt>Förderfähige Kosten</dt><dd>{formatCents(fc.eligibleCostsCents)}</dd>{/if}
        {#if fc.approvedAmountCents != null}<dt>Bewilligt</dt><dd>{formatCents(fc.approvedAmountCents)}</dd>{/if}
        {#if fc.ratePercent != null}<dt>Fördersatz</dt><dd>{fc.ratePercent} %</dd>{/if}
        {#if fc.bonuses.length}<dt>Boni</dt><dd>{fc.bonuses.join(", ")}</dd>{/if}
      </dl>
      <h4>Berechnete Fristen</h4>
      {#if fc.deadlines.length === 0}
        <p class="muted small">Keine – es fehlen Ankerdaten (z. B. Zusagedatum).</p>
      {:else}
        <ul class="plain" data-testid="funding-deadlines">
          {#each fc.deadlines as d (d.id)}
            <li class="spread">
              <span>{d.title}</span>
              <span class="row">
                <span class="small">{formatDate(d.dueDate)}</span>
                <DeadlineBadge status={d.status} dueDate={d.dueDate} remindFrom={d.remindFrom} />
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      <details>
        <summary>Förderfall bearbeiten</summary>
        <form method="post" action="?/updateFunding" class="stack edit" use:enhance={keepValues}>
          <input type="hidden" name="fundingId" value={fc.id} />
          <FundingForm funding={fc} programs={data.programs} />
          <div><button type="submit" class="primary">Speichern</button></div>
        </form>
      </details>
    </article>
  {:else}
    <p class="muted">Kein Förderfall angelegt.</p>
  {/each}
</section>

<section id="fristen" class="card">
  <h2>Fristen</h2>
  {#if data.deadlines.length === 0}
    <p class="muted">Keine Fristen.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Frist</th><th>Fällig</th><th>Status</th><th><span class="visually-hidden">Aktionen</span></th></tr>
        </thead>
        <tbody>
          {#each data.deadlines as d (d.id)}
            <tr>
              <td>
                {d.title}
                {#if !d.fundingCaseId}<span class="badge">Wiedervorlage</span>{/if}
                {#if d.note}<div class="small muted">{d.note}</div>{/if}
              </td>
              <td class="nowrap">{formatDate(d.dueDate)}</td>
              <td><DeadlineBadge status={d.status} dueDate={d.dueDate} remindFrom={d.remindFrom} /></td>
              <td>
                <form method="post" action="?/deadlineStatus" use:enhance class="row">
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
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <details>
    <summary>Wiedervorlage anlegen</summary>
    <form method="post" action="?/createDeadline" class="form-grid edit" use:enhance>
      <label class="full">Titel <input name="title" required /></label>
      <label>Fällig am <input type="date" name="dueDate" required /></label>
      <label>Erinnern ab <input type="date" name="remindFrom" /></label>
      <label class="full">Notiz <input name="note" /></label>
      <div><button type="submit" class="primary">Anlegen</button></div>
    </form>
  </details>
  {#if manualDeadlines.length > 0}
    <p class="small muted">{manualDeadlines.length} manuelle Wiedervorlage(n).</p>
  {/if}
</section>

<section id="chronik" class="card">
  <h2>Chronik</h2>
  <Timeline items={data.timeline} />
</section>

<section id="nachrichten" class="card">
  <h2>Nachrichten</h2>
  {#if k.communications.length === 0}
    <p class="muted">Keine Nachrichten.</p>
  {:else}
    <ul class="plain">
      {#each k.communications as m (m.id)}
        <li>
          <div class="spread">
            <span>
              <span class="badge">{COMM_CHANNEL_LABELS[m.channel] ?? m.channel}</span>
              <span class="small muted">{DIRECTION_LABELS[m.direction] ?? m.direction}</span>
              <strong>{m.subject ?? ""}</strong>
            </span>
            <time class="small muted" datetime={m.occurredAt}>{formatDateTime(m.occurredAt)}</time>
          </div>
          {#if m.body}
            <details><summary class="small">Text</summary><pre class="body">{m.body}</pre></details>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section id="belege" class="card">
  <div class="spread">
    <h2>Belege</h2>
    <div class="row">
      <a class="button" href="/belege/neu?vorgang={k.id}&kontakt={k.customerId}&art=angebot">Angebot erstellen</a>
      <a class="button primary" href="/belege/neu?vorgang={k.id}&kontakt={k.customerId}&art=rechnung">Rechnung erstellen</a>
    </div>
  </div>
  {#if data.billing.length === 0}
    <p class="muted">Noch keine Belege.</p>
  {:else}
    <ul class="plain">
      {#each data.billing as b (b.id)}
        <li class="spread">
          <a href="/belege/{b.id}">{BILLING_TYPE_LABELS[b.type]} {b.number ?? "(Entwurf)"}</a>
          <span class="row">
            <span class="small muted">{formatDate(b.issueDate)}</span>
            <span>{formatCents(b.grossCents)}</span>
            <BillingStatusBadge status={b.status} />
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section id="dokumente" class="card">
  <h2>Dokumente</h2>
  {#if k.documents.length === 0}
    <p class="muted">Keine Dokumente.</p>
  {:else}
    <ul class="plain">
      {#each k.documents as doc (doc.id)}
        <li class="spread">
          <a href="/dokumente/{doc.id}" target="_blank" rel="noopener">{doc.title}</a>
          <span class="row">
            {#if doc.docClass}<span class="badge">{doc.docClass}</span>{/if}
            <a class="small" href="/dokumente/{doc.id}?download">Herunterladen</a>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section id="begehungen" class="card">
  <h2>Begehungen</h2>
  {#if data.inspections.length === 0}
    <p class="muted">Keine Begehungen.</p>
  {:else}
    <ul class="plain">
      {#each data.inspections as b (b.id)}
        <li class="spread">
          <span>{b.title} <span class="small muted">{formatDateTime(b.startedAt)}</span></span>
          <span class="row">
            {#if b.status === "abgeschlossen"}
              <span class="badge ok">abgeschlossen</span>
              {#if b.protocolDocumentId}<a href="/dokumente/{b.protocolDocumentId}">Protokoll</a>{/if}
            {:else}
              <span class="badge warn">laufend</span>
              <a href="/vor-ort?b={b.id}">Fortsetzen</a>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .subnav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    margin: 0.5rem 0 1rem;
  }
  .edit {
    margin: 0.75rem 0 1rem;
  }
  .funding {
    border-top: 1px solid var(--border);
    padding-top: 0.75rem;
    margin-top: 0.75rem;
  }
  .new-funding {
    background: var(--surface-2);
    padding: 0.75rem;
    border-radius: var(--radius);
    margin: 0.75rem 0;
  }
  h4 {
    margin: 0.75rem 0 0.25rem;
  }
  details {
    margin-top: 0.75rem;
  }
  .head-meta {
    margin: 0 0 0.5rem;
  }
  .inline-form {
    display: inline;
  }
</style>
