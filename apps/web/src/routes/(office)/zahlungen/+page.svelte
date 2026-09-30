<script lang="ts">
  import { enhance } from "$app/forms";
  import type { components } from "$lib/api/schema";
  import FormError from "$lib/components/FormError.svelte";
  import { formatCents, formatDate } from "$lib/format";
  import { BANK_STATUS_LABELS } from "$lib/labels";
  import type { ActionData, PageData } from "./$types";

  type Tx = components["schemas"]["BankTransaction"];

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let splitFor = $state<string | null>(null);
  let splitRows = $state<{ doc: string; amount: string }[]>([]);

  function openSplit(t: Tx) {
    splitFor = t.id;
    splitRows =
      t.allocations.length > 0
        ? t.allocations.map((a) => ({
            doc: a.billingDocumentId,
            amount: (a.amountCents / 100).toFixed(2).replace(".", ","),
          }))
        : [{ doc: "", amount: (t.amountCents / 100).toFixed(2).replace(".", ",") }];
  }
  const tone = (s: string) =>
    s === "zugeordnet" ? "ok" : s === "teilweise" ? "warn" : s === "offen" ? "info" : "";
</script>

<svelte:head><title>Zahlungen – objektakte</title></svelte:head>

<div class="spread">
  <h1>Zahlungen</h1>
  <form method="post" action="?/rematch" use:enhance>
    <button type="submit">Erneut abgleichen</button>
  </form>
</div>

<FormError {form} />
{#if form && "done" in form}<p class="success" role="status">{form.done}</p>{/if}
{#if form && "imported" in form && form.imported}
  {@const r = form.imported}
  <div class="success stack" role="status" data-testid="import-result">
    <strong>Kontoauszug übernommen</strong>
    <span>{r.received} Umsätze gelesen, {r.imported} neu, {r.duplicates} bereits vorhanden, {r.allocated} automatisch zugeordnet.</span>
    {#if r.errors.length}
      <ul class="small">{#each r.errors as e (e.line)}<li>Zeile {e.line}: {e.message}</li>{/each}</ul>
    {/if}
  </div>
{/if}

<section class="card">
  <h2>Kontoauszug einlesen (CSV)</h2>
  <form method="post" action="?/import" enctype="multipart/form-data" class="row upload" use:enhance>
    <label>Konto <input name="account" value="Geschäftskonto" required /></label>
    <label>Datei <input type="file" name="file" accept=".csv,text/csv" required /></label>
    <button type="submit" class="primary">Einlesen</button>
  </form>
  <p class="small muted">
    Spaltenzuordnung unter <a href="/einstellungen/bank">Einstellungen → Bank-CSV</a>. Doppelte Umsätze
    werden erkannt; eine Datei kann gefahrlos erneut eingelesen werden.
  </p>
</section>

<form method="get" class="row filters">
  <label
    >Status
    <select name="status" value={data.filter.status}>
      <option value="">alle</option>
      {#each Object.entries(BANK_STATUS_LABELS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
    </select>
  </label>
  <button type="submit">Filtern</button>
</form>

{#each data.transactions as t (t.id)}
  <article class="card tx" data-testid="bank-transaction">
    <div class="spread">
      <div>
        <strong class={t.amountCents < 0 ? "neg" : ""}>{formatCents(t.amountCents)}</strong>
        <span class="small muted">{formatDate(t.bookingDate)} · {t.account}</span>
      </div>
      <span class="badge {tone(t.status)}">{BANK_STATUS_LABELS[t.status]}</span>
    </div>
    <div class="small">
      {t.counterpartyName ?? "–"}
      {#if t.counterpartyIban}<div class="mono muted">{t.counterpartyIban}</div>{/if}
    </div>
    {#if t.purpose}<div class="small purpose">{t.purpose}</div>{/if}

    {#if t.allocations.length > 0}
      <ul class="plain small">
        {#each t.allocations as a (a.billingDocumentId)}
          <li>
            → <a href="/belege/{a.billingDocumentId}">{a.number ?? "Beleg"}</a>: {formatCents(a.amountCents)}
            <span class="muted">({a.source}{a.reason ? `, ${a.reason}` : ""})</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if t.status !== "zugeordnet" && t.status !== "ignoriert" && t.suggestions.length > 0}
      <div class="suggestions">
        <span class="small">Vorschläge:</span>
        {#each t.suggestions as s (s.billingDocumentId)}
          <form method="post" action="?/accept" use:enhance class="row">
            <input type="hidden" name="transactionId" value={t.id} />
            <input type="hidden" name="billingDocumentId" value={s.billingDocumentId} />
            <input type="hidden" name="amountCents" value={s.amountCents} />
            <button type="submit" class="small primary">
              {s.number}: {formatCents(s.amountCents)} übernehmen
            </button>
            <span class="small muted">{Math.round(s.score * 100)} % · {s.reason}</span>
          </form>
        {/each}
      </div>
    {/if}

    {#if t.amountCents > 0}
      <div class="row">
        <button type="button" class="small" onclick={() => (splitFor === t.id ? (splitFor = null) : openSplit(t))}>
          {splitFor === t.id ? "Abbrechen" : "Manuell zuordnen"}
        </button>
        {#if t.status !== "ignoriert"}
          <form method="post" action="?/ignore" use:enhance>
            <input type="hidden" name="transactionId" value={t.id} />
            <button type="submit" class="small">Ignorieren</button>
          </form>
        {/if}
      </div>
    {:else if t.status !== "ignoriert"}
      <form method="post" action="?/ignore" use:enhance>
        <input type="hidden" name="transactionId" value={t.id} />
        <button type="submit" class="small">Ignorieren</button>
      </form>
    {/if}

    {#if splitFor === t.id}
      <form
        method="post"
        action="?/allocate"
        class="stack split"
        use:enhance={() =>
          async ({ result, update }) => {
            await update();
            if (result.type === "success") splitFor = null;
          }}
      >
        <input type="hidden" name="transactionId" value={t.id} />
        {#each splitRows as row, i (i)}
          <div class="row">
            <label class="grow"
              >Rechnung
              <select name="allocDoc" bind:value={row.doc}>
                <option value="">– wählen –</option>
                {#each data.receivables as r (r.billingDocumentId)}
                  <option value={r.billingDocumentId}>{r.number} · {r.contactName} · offen {formatCents(r.openCents)}</option>
                {/each}
                {#each t.allocations.filter((a) => !data.receivables.some((r) => r.billingDocumentId === a.billingDocumentId)) as a (a.billingDocumentId)}
                  <option value={a.billingDocumentId}>{a.number} (bereits zugeordnet)</option>
                {/each}
              </select>
            </label>
            <label>Betrag (€) <input name="allocAmount" bind:value={row.amount} inputmode="decimal" /></label>
            <button type="button" class="small self-end" onclick={() => (splitRows = splitRows.filter((_, j) => j !== i))}>Entfernen</button>
          </div>
        {/each}
        <div class="row">
          <button type="button" class="small" onclick={() => (splitRows = [...splitRows, { doc: "", amount: "" }])}>+ Aufteilen</button>
          <button type="submit" class="primary small">Zuordnung speichern</button>
        </div>
        <p class="small muted">Leere Liste speichern löst bestehende Zuordnungen.</p>
      </form>
    {/if}
  </article>
{:else}
  <p class="muted">Keine Umsätze.</p>
{/each}

<style>
  .upload {
    align-items: flex-end;
  }
  .filters {
    align-items: flex-end;
    margin: 1rem 0;
  }
  .tx {
    margin-bottom: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .neg {
    color: var(--danger);
  }
  .purpose {
    background: var(--surface-2);
    padding: 0.3rem 0.5rem;
    border-radius: 6px;
  }
  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .split {
    background: var(--surface-2);
    padding: 0.75rem;
    border-radius: var(--radius);
  }
  .grow {
    flex: 1;
    min-width: 14rem;
  }
  .self-end {
    align-self: flex-end;
  }
</style>
