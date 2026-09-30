<script lang="ts">
  import FormError from "$lib/components/FormError.svelte";
  import ObjectForm from "$lib/components/ObjectForm.svelte";
  import SearchPicker from "$lib/components/SearchPicker.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const contactOptions = $derived(
    data.contacts.map((c) => ({ id: c.id, label: c.displayName, hint: c.city })),
  );
  // svelte-ignore state_referenced_locally
  let ownerId = $state(data.ownerId);
</script>

<svelte:head><title>Neues Objekt – objektakte</title></svelte:head>

<h1>Neues Objekt</h1>
<form method="post" class="card stack">
  <FormError {form} />
  <ObjectForm />
  <SearchPicker name="ownerId" label="Eigentümer (optional)" options={contactOptions} bind:value={ownerId} />
  <div class="row">
    <button type="submit" class="primary">Anlegen</button>
    <a href="/objekte">Abbrechen</a>
  </div>
</form>
