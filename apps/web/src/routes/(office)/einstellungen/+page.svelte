<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import { keepValues } from "$lib/enhance";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Einstellungen – objektakte</title></svelte:head>

<form method="post" class="card stack" use:enhance={keepValues}>
  <h2>Kommunikation und Zuordnung</h2>
  <FormError {form} />
  {#if form && "saved" in form}<p class="success" role="status">Gespeichert.</p>{/if}
  <label
    >Eigene Adressen und Nummern (je Zeile)
    <textarea name="ownAddresses" rows="4">{data.settings.ownAddresses.join("\n")}</textarea>
  </label>
  <p class="small muted">Werden bei der Zuordnung nie als Gegenüber gewertet.</p>
  <label
    >Ignorierte Adressen (je Zeile)
    <textarea name="ignoredAddresses" rows="4">{data.settings.ignoredAddresses.join("\n")}</textarea>
  </label>
  <label
    >Schwellwert für automatische Zuordnung (0–1)
    <input
      name="autoAssignThreshold"
      type="number"
      step="0.05"
      min="0"
      max="1"
      value={data.settings.autoAssignThreshold}
    />
  </label>
  <div><button type="submit" class="primary">Speichern</button></div>
</form>
