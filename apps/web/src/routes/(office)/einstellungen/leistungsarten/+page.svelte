<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import { keepValues } from "$lib/enhance";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Leistungsarten – objektakte</title></svelte:head>

<FormError {form} />
<section class="card">
  <h2>Leistungsarten</h2>
  <p class="small muted">Das Kürzel ist zugleich Präfix der Vorgangsnummer.</p>
  <ul class="plain">
    {#each data.items as m (m.code)}
      <li>
        <details>
          <summary>
            <span class="mono">{m.code}</span> – {m.name}
            {#if !m.active}<span class="badge">inaktiv</span>{/if}
          </summary>
          <form method="post" action="?/save" class="form-grid edit" use:enhance={keepValues}>
            <input type="hidden" name="code" value={m.code} />
            <label>Bezeichnung <input name="name" value={m.name} required /></label>
            <label>Beschreibung <input name="description" value={m.description ?? ""} /></label>
            <label class="inline"><input type="checkbox" name="active" checked={m.active} /> aktiv</label>
            <div><button type="submit" class="primary small">Speichern</button></div>
          </form>
        </details>
      </li>
    {/each}
  </ul>
</section>

<section class="card">
  <h2>Neue Leistungsart</h2>
  <form method="post" action="?/save" class="form-grid" use:enhance>
    <label>Kürzel <input name="code" required pattern="[A-Za-zÄÖÜäöü0-9_]{'{'}1,20{'}'}" /></label>
    <label>Bezeichnung <input name="name" required /></label>
    <label class="full">Beschreibung <input name="description" /></label>
    <label class="inline"><input type="checkbox" name="active" checked /> aktiv</label>
    <div><button type="submit" class="primary">Anlegen</button></div>
  </form>
</section>

<style>
  .edit {
    margin: 0.5rem 0;
  }
</style>
