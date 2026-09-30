<script lang="ts">
  import { enhance } from "$app/forms";
  import type { components } from "$lib/api/schema";
  import FormError from "$lib/components/FormError.svelte";
  import { keepValues } from "$lib/enhance";
  import { ANCHOR_LABELS, ANCHORS } from "$lib/labels";
  import type { ActionData, PageData } from "./$types";

  type Rule = components["schemas"]["DeadlineRule"];

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const programName = (code: string) =>
    code === "*" ? "alle Programme" : (data.programs.find((p) => p.code === code)?.name ?? code);
  const offset = (r: Rule) =>
    [r.offsetMonths ? `${r.offsetMonths} Monate` : "", r.offsetDays ? `${r.offsetDays} Tage` : ""]
      .filter(Boolean)
      .join(" + ") || "0";
</script>

<svelte:head><title>Fristenregeln – objektakte</title></svelte:head>

{#snippet ruleFields(r: Rule | null)}
  <label
    >Programm
    <select name="programCode" value={r?.programCode ?? "*"}>
      <option value="*">alle Programme (*)</option>
      {#each data.programs as p (p.code)}<option value={p.code}>{p.name}</option>{/each}
    </select>
  </label>
  <label>Richtlinienstand <input name="guideline" value={r?.guideline ?? ""} placeholder="alle" /></label>
  <label class="full">Titel <input name="title" value={r?.title ?? ""} required /></label>
  <label
    >Anker
    <select name="anchor" value={r?.anchor ?? "approved_at"}>
      {#each ANCHORS as a (a)}<option value={a}>{ANCHOR_LABELS[a]}</option>{/each}
    </select>
  </label>
  <label>Versatz Monate <input name="offsetMonths" type="number" value={r?.offsetMonths ?? 0} /></label>
  <label>Versatz Tage <input name="offsetDays" type="number" value={r?.offsetDays ?? 0} /></label>
  <label>Vorlauf (Tage) <input name="leadDays" type="number" min="0" value={r?.leadDays ?? 30} /></label>
  <label
    >Erledigt durch
    <select name="doneWhen" value={r?.doneWhen ?? ""}>
      <option value="">– nicht automatisch –</option>
      {#each ANCHORS as a (a)}<option value={a}>{ANCHOR_LABELS[a]}</option>{/each}
    </select>
  </label>
  <label class="full">Beschreibung <input name="description" value={r?.description ?? ""} /></label>
  <label class="full">Quelle <input name="sourceNote" value={r?.sourceNote ?? ""} placeholder="Richtlinie, Merkblatt …" /></label>
  <label class="inline"><input type="checkbox" name="active" checked={r?.active ?? true} /> aktiv</label>
{/snippet}

<FormError {form} />
<section class="card">
  <h2>Fristenregeln</h2>
  <p class="small muted">
    Frist = Anker + Versatz. Änderungen berechnen die Fristen der betroffenen Förderfälle neu.
  </p>
  <ul class="plain">
    {#each data.rules as r (r.id)}
      <li>
        <div class="spread">
          <div>
            <strong>{r.title}</strong>
            {#if !r.active}<span class="badge">inaktiv</span>{/if}
            <div class="small muted">
              {programName(r.programCode)}{#if r.guideline} · {r.guideline}{/if} ·
              {ANCHOR_LABELS[r.anchor]} + {offset(r)}
              {#if r.doneWhen}· erledigt durch {ANCHOR_LABELS[r.doneWhen]}{/if}
            </div>
          </div>
          <form method="post" action="?/toggle" use:enhance>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="active" value={String(!r.active)} />
            <button type="submit" class="small">{r.active ? "Deaktivieren" : "Aktivieren"}</button>
          </form>
        </div>
        <details>
          <summary class="small">Bearbeiten</summary>
          <form method="post" action="?/update" class="form-grid edit" use:enhance={keepValues}>
            <input type="hidden" name="id" value={r.id} />
            {@render ruleFields(r)}
            <div><button type="submit" class="primary small">Speichern</button></div>
          </form>
        </details>
      </li>
    {/each}
  </ul>
</section>

<section class="card">
  <h2>Neue Regel</h2>
  <form method="post" action="?/create" class="form-grid" use:enhance>
    {@render ruleFields(null)}
    <div><button type="submit" class="primary">Anlegen</button></div>
  </form>
</section>

<style>
  .edit {
    margin: 0.5rem 0;
  }
</style>
