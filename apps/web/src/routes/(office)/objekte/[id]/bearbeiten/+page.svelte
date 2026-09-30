<script lang="ts">
  import FormError from "$lib/components/FormError.svelte";
  import ObjectForm from "$lib/components/ObjectForm.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Objekt bearbeiten – objektakte</title></svelte:head>

<h1>{data.object.label} bearbeiten</h1>
<form method="post" class="card stack">
  <FormError {form} />
  <ObjectForm object={data.object} />
  <div class="row">
    <button type="submit" class="primary">Speichern</button>
    <a href="/objekte/{data.object.id}">Abbrechen</a>
  </div>
</form>
