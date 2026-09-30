<script lang="ts">
  import ContactForm from "$lib/components/ContactForm.svelte";
  import FormError from "$lib/components/FormError.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Kontakt bearbeiten – objektakte</title></svelte:head>

<h1>{data.contact.displayName} bearbeiten</h1>
<form method="post" class="card stack">
  <FormError {form} />
  <ContactForm contact={data.contact} />
  <div class="row">
    <button type="submit" class="primary">Speichern</button>
    <a href="/kontakte/{data.contact.id}">Abbrechen</a>
  </div>
</form>
