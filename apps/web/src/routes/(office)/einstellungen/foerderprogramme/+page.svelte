<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import { keepValues } from "$lib/enhance";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Förderprogramme – objektakte</title></svelte:head>

<FormError {form} />
<section class="card">
  <h2>Förderprogramme</h2>
  <ul class="plain">
    {#each data.items as p (p.code)}
      <li>
        <details>
          <summary>
            {p.name} <span class="mono small muted">{p.code}</span>
            {#if p.approvalPeriodMonths}<span class="small muted">· {p.approvalPeriodMonths} Monate Bewilligungszeitraum</span>{/if}
            {#if !p.active}<span class="badge">inaktiv</span>{/if}
          </summary>
          <form method="post" action="?/save" class="form-grid edit" use:enhance={keepValues}>
            <input type="hidden" name="code" value={p.code} />
            <label>Bezeichnung <input name="name" value={p.name} required /></label>
            <label
              >Bewilligungszeitraum (Monate) <input
                name="approvalPeriodMonths"
                type="number"
                min="1"
                value={p.approvalPeriodMonths ?? ""}
              /></label
            >
            <label class="inline"><input type="checkbox" name="active" checked={p.active} /> aktiv</label>
            <div><button type="submit" class="primary small">Speichern</button></div>
          </form>
        </details>
      </li>
    {/each}
  </ul>
</section>

<section class="card">
  <h2>Neues Förderprogramm</h2>
  <form method="post" action="?/save" class="form-grid" use:enhance>
    <label>Code <input name="code" required pattern="[a-z0-9_]+" placeholder="z. B. beg_em" /></label>
    <label>Bezeichnung <input name="name" required /></label>
    <label>Bewilligungszeitraum (Monate) <input name="approvalPeriodMonths" type="number" min="1" /></label>
    <label class="inline"><input type="checkbox" name="active" checked /> aktiv</label>
    <div><button type="submit" class="primary">Anlegen</button></div>
  </form>
</section>

<style>
  .edit {
    margin: 0.5rem 0;
  }
</style>
