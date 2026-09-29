<script lang="ts">
  import BillingForm from "$lib/components/BillingForm.svelte";
  import FormError from "$lib/components/FormError.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Neuer Beleg – objektakte</title></svelte:head>

<h1>Neuer Beleg</h1>
{#if data.companyMissing}
  <p class="problems">
    Firmendaten fehlen noch – ohne sie lässt sich nichts festschreiben.
    <a href="/einstellungen/firma">Firmendaten erfassen</a>
  </p>
{/if}
<form method="post" class="card stack">
  <FormError {form} />
  <BillingForm
    contacts={data.contacts}
    cases={data.cases}
    articles={data.articles}
    smallBusiness={data.smallBusiness}
    defaults={data.defaults}
  />
  <div class="row">
    <button type="submit" class="primary">Entwurf anlegen</button>
    <a href="/belege">Abbrechen</a>
  </div>
</form>
