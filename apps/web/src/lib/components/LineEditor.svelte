<script lang="ts">
  import type { components } from "$lib/api/schema";
  import {
    centsToInput,
    computeDraftTotals,
    type LineDraft,
    type LinePayload,
    lineNetCents,
    toPayload,
  } from "$lib/billing";
  import { formatCents } from "$lib/format";
  import { TAX_CATEGORIES, TAX_CATEGORY_LABELS, UNIT_CODES, UNIT_LABELS } from "$lib/labels";

  type Article = components["schemas"]["Article"];
  type LineOut = components["schemas"]["BillingDocument"]["lines"][number];

  let {
    lines = [],
    articles,
    smallBusiness = false,
    onchange,
  }: {
    lines?: LineOut[];
    articles: Article[];
    smallBusiness?: boolean;
    onchange?: () => void;
  } = $props();

  const empty = (): LineDraft => ({
    articleCode: "",
    name: "",
    description: "",
    quantity: "1",
    unitCode: "HUR",
    unitPrice: "",
    taxCategory: "S",
    taxRatePercent: "19",
  });

  // svelte-ignore state_referenced_locally
  let rows = $state<LineDraft[]>(
    lines.length > 0
      ? lines.map((l) => ({
          articleCode: l.articleCode ?? "",
          name: l.name,
          description: l.description ?? "",
          quantity: String(l.quantity).replace(".", ","),
          unitCode: l.unitCode,
          unitPrice: centsToInput(l.unitPriceCents),
          taxCategory: l.taxCategory,
          taxRatePercent: String(l.taxRatePercent).replace(".", ","),
        }))
      : [empty()],
  );

  const results = $derived(rows.map((r, i) => toPayload(r, i)));
  const valid = $derived(results.filter((r): r is LinePayload => typeof r !== "string"));
  const problems = $derived(results.filter((r): r is string => typeof r === "string"));
  const totals = $derived(computeDraftTotals(valid, smallBusiness));
  const serialized = $derived(JSON.stringify(valid));

  function changed() {
    onchange?.();
  }

  function applyArticle(row: LineDraft, code: string) {
    const a = articles.find((x) => x.code === code);
    row.articleCode = code;
    if (!a) return changed();
    row.name = a.name;
    row.description = a.description ?? "";
    row.unitCode = a.unitCode;
    row.unitPrice = centsToInput(a.unitPriceCents);
    row.taxCategory = a.taxCategory;
    row.taxRatePercent = String(a.taxRatePercent).replace(".", ",");
    changed();
  }

  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= rows.length) return;
    const copy = [...rows];
    [copy[i], copy[j]] = [copy[j] as LineDraft, copy[i] as LineDraft];
    rows = copy;
    changed();
  }
</script>

<input type="hidden" name="lines" value={serialized} />
<input type="hidden" name="linesTotal" value={rows.length} />

<fieldset class="lines">
  <legend>Positionen</legend>
  {#each rows as row, i (i)}
    {@const r = results[i]}
    <div class="line" data-testid="billing-line">
      <div class="head">
        <strong>Pos. {i + 1}</strong>
        <span class="row">
          <button type="button" class="small" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Position {i + 1} nach oben">↑</button>
          <button type="button" class="small" onclick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Position {i + 1} nach unten">↓</button>
          <button
            type="button"
            class="small"
            disabled={rows.length === 1}
            onclick={() => {
              rows = rows.filter((_, j) => j !== i);
              changed();
            }}
            aria-label="Position {i + 1} entfernen">Entfernen</button
          >
        </span>
      </div>
      <div class="grid-line">
        <label class="article"
          >Artikel
          <select value={row.articleCode} onchange={(e) => applyArticle(row, e.currentTarget.value)}>
            <option value="">– frei –</option>
            {#each articles.filter((a) => a.active || a.code === row.articleCode) as a (a.code)}
              <option value={a.code}>{a.code} – {a.name}</option>
            {/each}
          </select>
        </label>
        <label class="name">Bezeichnung <input bind:value={row.name} oninput={changed} required /></label>
        <label class="qty">Menge <input bind:value={row.quantity} oninput={changed} inputmode="decimal" /></label>
        <label class="unit"
          >Einheit
          <select bind:value={row.unitCode} onchange={changed}>
            {#each UNIT_CODES as u (u)}<option value={u}>{UNIT_LABELS[u]} ({u})</option>{/each}
          </select>
        </label>
        <label class="price"
          >Einzelpreis netto (€) <input bind:value={row.unitPrice} oninput={changed} inputmode="decimal" /></label
        >
        <label class="cat"
          >Steuer
          <select bind:value={row.taxCategory} onchange={changed}>
            {#each TAX_CATEGORIES as c (c)}<option value={c}>{TAX_CATEGORY_LABELS[c]}</option>{/each}
          </select>
        </label>
        <label class="rate"
          >Satz (%) <input
            bind:value={row.taxRatePercent}
            oninput={changed}
            inputmode="decimal"
            disabled={row.taxCategory !== "S"}
          /></label
        >
        <label class="desc">Beschreibung <textarea rows="1" bind:value={row.description} oninput={changed}></textarea></label>
      </div>
      {#if typeof r === "string"}
        <p class="small warn-text">{r}</p>
      {:else if r}
        <p class="small muted sum">
          Summe netto: {formatCents(lineNetCents(r.quantity, r.unitPriceCents))}
        </p>
      {/if}
    </div>
  {/each}
  <button
    type="button"
    onclick={() => {
      rows = [...rows, empty()];
      changed();
    }}>+ Position</button
  >
</fieldset>

<div class="totals card" aria-live="polite" data-testid="live-totals">
  <dl class="facts">
    <dt>Netto</dt>
    <dd>{formatCents(totals.netCents)}</dd>
    {#each totals.groups as g (g.category + g.ratePercent)}
      <dt>USt {g.category === "S" ? `${g.ratePercent} %` : g.category}</dt>
      <dd>{formatCents(g.taxCents)} <span class="small muted">auf {formatCents(g.basisCents)}</span></dd>
    {/each}
    <dt><strong>Brutto</strong></dt>
    <dd><strong data-testid="gross-total">{formatCents(totals.grossCents)}</strong></dd>
  </dl>
  {#if smallBusiness}<p class="small muted">Kleinunternehmer (§ 19 UStG): keine Umsatzsteuer.</p>{/if}
  {#if problems.length > 0}
    <p class="small warn-text">{problems.length} Position(en) unvollständig – werden nicht gespeichert.</p>
  {/if}
</div>

<style>
  .lines {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  legend {
    font-weight: 600;
  }
  .line {
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.75rem;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.35rem;
  }
  .grid-line {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: repeat(12, minmax(0, 1fr));
  }
  .article {
    grid-column: span 3;
  }
  .name {
    grid-column: span 5;
  }
  .qty {
    grid-column: span 2;
  }
  .unit {
    grid-column: span 2;
  }
  .price {
    grid-column: span 3;
  }
  .cat {
    grid-column: span 4;
  }
  .rate {
    grid-column: span 2;
  }
  .desc {
    grid-column: span 3;
  }
  @media (max-width: 50rem) {
    .grid-line > label {
      grid-column: span 6;
    }
    .grid-line > .name,
    .grid-line > .desc {
      grid-column: span 12;
    }
  }
  .warn-text {
    color: var(--warn);
    margin: 0.25rem 0 0;
  }
  .sum {
    margin: 0.25rem 0 0;
    text-align: right;
  }
  .totals {
    margin-top: 0.75rem;
    max-width: 26rem;
    margin-left: auto;
  }
</style>
