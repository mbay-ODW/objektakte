<script lang="ts">
  import CaseForm from "$lib/components/CaseForm.svelte";
  import FormError from "$lib/components/FormError.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const contacts = $derived(
    data.contacts.map((c) => ({ id: c.id, label: c.displayName, hint: c.city })),
  );
  const objects = $derived(
    data.objects.map((o) => ({ id: o.id, label: o.label, hint: [o.street, o.city].filter(Boolean).join(", ") })),
  );
</script>

<svelte:head><title>Neuer Vorgang – objektakte</title></svelte:head>

<h1>Neuer Vorgang</h1>
<form method="post" class="card stack">
  <FormError {form} />
  <CaseForm
    measureTypes={data.measureTypes}
    {contacts}
    {objects}
    showNumber
    customerId={data.customerId}
    objectId={data.objectId}
  />
  <div class="row">
    <button type="submit" class="primary">Anlegen</button>
    <a href="/vorgaenge">Abbrechen</a>
  </div>
</form>
