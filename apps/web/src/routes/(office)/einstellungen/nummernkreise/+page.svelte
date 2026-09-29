<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import { keepValues } from "$lib/enhance";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Nummernkreise – objektakte</title></svelte:head>

<FormError {form} />
<section class="card">
  <h2>Nummernkreise</h2>
  <p class="small muted">Nummernkreise lassen sich nur erhöhen (Lückenlosigkeit und Eindeutigkeit).</p>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Schlüssel</th><th>Nächster Wert</th><th>Stellen</th><th></th></tr></thead>
      <tbody>
        {#each data.items as s (s.key)}
          <tr>
            <td class="mono">{s.key}</td>
            <td colspan="3">
              <form method="post" action="?/save" class="row" use:enhance={keepValues}>
                <input type="hidden" name="key" value={s.key} />
                <label class="visually-hidden" for="nv-{s.key}">Nächster Wert</label>
                <input id="nv-{s.key}" name="nextValue" type="number" min={s.nextValue} value={s.nextValue} />
                <label class="visually-hidden" for="pd-{s.key}">Stellen</label>
                <input id="pd-{s.key}" name="padding" type="number" min="0" max="10" value={s.padding} />
                <button type="submit" class="small">Setzen</button>
              </form>
            </td>
          </tr>
        {:else}
          <tr><td colspan="4" class="muted">Noch keine Nummernkreise.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<section class="card">
  <h2>Nummernkreis anlegen</h2>
  <form method="post" action="?/save" class="form-grid" use:enhance>
    <label>Schlüssel <input name="key" required placeholder="z. B. case" /></label>
    <label>Nächster Wert <input name="nextValue" type="number" min="1" required /></label>
    <label>Stellen <input name="padding" type="number" min="0" max="10" value="0" /></label>
    <div><button type="submit" class="primary">Speichern</button></div>
  </form>
</section>

<style>
  form.row input {
    max-width: 9rem;
  }
</style>
