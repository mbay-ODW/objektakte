<script lang="ts">
  import ContactForm from "$lib/components/ContactForm.svelte";
  import FormError from "$lib/components/FormError.svelte";
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Neuer Kontakt – objektakte</title></svelte:head>

<h1>Neuer Kontakt</h1>
<form method="post" class="card stack">
  <FormError {form} />
  <ContactForm />
  <div class="row">
    <button type="submit" class="primary">Anlegen</button>
    <a href="/kontakte">Abbrechen</a>
  </div>
</form>
