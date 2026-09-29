<script lang="ts">
  import { enhance } from "$app/forms";
  import type { components } from "$lib/api/schema";
  import FormError from "$lib/components/FormError.svelte";
  import { keepValues } from "$lib/enhance";
  import { centsInput, formatCents } from "$lib/format";
  import { TAX_CATEGORIES, TAX_CATEGORY_LABELS, UNIT_CODES, UNIT_LABELS } from "$lib/labels";
  import type { ActionData, PageData } from "./$types";

  type Article = components["schemas"]["Article"];
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Artikel – objektakte</title></svelte:head>

{#snippet fields(a: Article | null)}
  {#if a}
    <input type="hidden" name="code" value={a.code} />
  {:else}
    <label>Kürzel <input name="code" required pattern={"[A-Za-z0-9._\\-]{1,40}"} placeholder="z. B. BERATUNG-STD" /></label>
  {/if}
  <label>Bezeichnung <input name="name" value={a?.name ?? ""} required /></label>
  <label class="full">Beschreibung <input name="description" value={a?.description ?? ""} /></label>
  <label
    >Einheit
    <select name="unitCode" value={a?.unitCode ?? "HUR"}>
      {#each UNIT_CODES as u (u)}<option value={u}>{UNIT_LABELS[u]} ({u})</option>{/each}
    </select>
  </label>
  <label>Einzelpreis netto (€) <input name="price" inputmode="decimal" value={a ? centsInput(a.unitPriceCents) : ""} required /></label>
  <label
    >Steuer
    <select name="taxCategory" value={a?.taxCategory ?? "S"}>
      {#each TAX_CATEGORIES as t (t)}<option value={t}>{TAX_CATEGORY_LABELS[t]}</option>{/each}
    </select>
  </label>
  <label>Steuersatz (%) <input name="taxRatePercent" inputmode="decimal" value={a?.taxRatePercent ?? 19} /></label>
  <label class="inline"><input type="checkbox" name="active" checked={a?.active ?? true} /> aktiv</label>
{/snippet}

<FormError {form} />
{#if form && "saved" in form}<p class="success" role="status">Gespeichert.</p>{/if}

<section class="card">
  <h2>Artikel und Leistungen</h2>
  <ul class="plain">
    {#each data.items as a (a.code)}
      <li>
        <details>
          <summary>
            <span class="mono">{a.code}</span> – {a.name}
            <span class="small muted">· {formatCents(a.unitPriceCents)} / {UNIT_LABELS[a.unitCode] ?? a.unitCode}
              · {a.taxCategory === "S" ? `${a.taxRatePercent} %` : a.taxCategory}</span>
            {#if !a.active}<span class="badge">inaktiv</span>{/if}
          </summary>
          <form method="post" action="?/save" class="form-grid edit" use:enhance={keepValues}>
            {@render fields(a)}
            <div><button type="submit" class="primary small">Speichern</button></div>
          </form>
        </details>
      </li>
    {:else}
      <li class="muted">Noch keine Artikel.</li>
    {/each}
  </ul>
</section>

<section class="card">
  <h2>Neuer Artikel</h2>
  <form method="post" action="?/save" class="form-grid" use:enhance>
    {@render fields(null)}
    <div><button type="submit" class="primary">Anlegen</button></div>
  </form>
</section>

<style>
  .edit {
    margin: 0.5rem 0;
  }
</style>
