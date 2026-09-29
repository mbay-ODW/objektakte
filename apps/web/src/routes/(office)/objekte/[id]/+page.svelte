<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import SearchPicker from "$lib/components/SearchPicker.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { formatDateTime } from "$lib/format";
  import { OBJECT_ROLE_LABELS, OBJECT_ROLES, USAGE_LABELS } from "$lib/labels";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const o = $derived(data.object);
  const contactOptions = $derived(
    data.contacts.map((c) => ({ id: c.id, label: c.displayName, hint: c.city })),
  );
  let newContact = $state("");
</script>

<svelte:head><title>{o.label} – objektakte</title></svelte:head>

<div class="spread">
  <h1>{o.label}</h1>
  <div class="row">
    <a class="button" href="/objekte/{o.id}/bearbeiten">Bearbeiten</a>
    <a class="button" href="/vorgaenge/neu?objectId={o.id}">Neuer Vorgang</a>
    <a class="button primary" href="/vor-ort?objekt={o.id}">Begehung starten</a>
  </div>
</div>

<div class="grid">
  <section class="card">
    <h2>Gebäude</h2>
    <dl class="facts">
      <dt>Anschrift</dt>
      <dd>{o.street ?? ""}<br />{[o.postalCode, o.city].filter(Boolean).join(" ")}</dd>
      <dt>Nutzung</dt>
      <dd>{USAGE_LABELS[o.usage]}</dd>
      {#if o.buildingType}<dt>Gebäudetyp</dt><dd>{o.buildingType}</dd>{/if}
      {#if o.constructionYear}<dt>Baujahr</dt><dd>{o.constructionYear}</dd>{/if}
      {#if o.heatedAreaM2}<dt>Beheizte Fläche</dt><dd>{o.heatedAreaM2.toLocaleString("de-DE")} m²</dd>{/if}
      {#if o.units}<dt>Einheiten</dt><dd>{o.units}</dd>{/if}
      {#if o.storagePath}<dt>Ablage</dt><dd class="mono small">{o.storagePath}</dd>{/if}
      {#if o.notes}<dt>Notizen</dt><dd><pre class="body">{o.notes}</pre></dd>{/if}
    </dl>
  </section>

  <section class="card" aria-labelledby="roles-h">
    <h2 id="roles-h">Beteiligte</h2>
    <FormError {form} />
    {#if o.roles.length === 0}
      <p class="muted">Noch keine Beteiligten.</p>
    {:else}
      <ul class="plain">
        {#each o.roles as r, i (r.contactId + r.role)}
          <li class="spread">
            <span>
              <a href="/kontakte/{r.contactId}">{r.displayName}</a>
              <span class="badge">{OBJECT_ROLE_LABELS[r.role] ?? r.role}</span>
            </span>
            <form method="post" action="?/removeRole" use:enhance>
              <input type="hidden" name="index" value={i} />
              <button type="submit" class="small" aria-label="{r.displayName} entfernen"
                >Entfernen</button
              >
            </form>
          </li>
        {/each}
      </ul>
    {/if}
    <form
      method="post"
      action="?/addRole"
      class="stack add-role"
      use:enhance={() =>
        async ({ update }) => {
          await update();
          newContact = "";
        }}
    >
      <SearchPicker name="contactId" label="Kontakt" options={contactOptions} bind:value={newContact} />
      <div class="row">
        <label class="grow"
          >Rolle
          <select name="role">
            {#each OBJECT_ROLES as r (r)}<option value={r}>{OBJECT_ROLE_LABELS[r]}</option>{/each}
          </select>
        </label>
        <button type="submit" class="self-end">Hinzufügen</button>
      </div>
    </form>
  </section>
</div>

<section class="card">
  <h2>Vorgänge</h2>
  {#if o.cases.length === 0}
    <p class="muted">Keine Vorgänge.</p>
  {:else}
    <ul class="plain">
      {#each o.cases as k (k.id)}
        <li class="spread">
          <a href="/vorgaenge/{k.id}">{k.number} – {k.title}</a>
          <StatusBadge status={k.status as never} />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card">
  <h2>Begehungen</h2>
  {#if data.inspections.length === 0}
    <p class="muted">Noch keine Begehungen.</p>
  {:else}
    <ul class="plain">
      {#each data.inspections as b (b.id)}
        <li class="spread">
          <span>{b.title} <span class="muted small">{formatDateTime(b.startedAt)}</span></span>
          <span class="row">
            {#if b.status === "abgeschlossen"}
              <span class="badge ok">abgeschlossen</span>
              {#if b.protocolDocumentId}<a href="/dokumente/{b.protocolDocumentId}">Protokoll</a>{/if}
            {:else}
              <span class="badge warn">laufend</span>
              <a href="/vor-ort?b={b.id}">Fortsetzen</a>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .add-role {
    margin-top: 1rem;
    border-top: 1px solid var(--border);
    padding-top: 0.75rem;
  }
  .grow {
    flex: 1;
  }
  .self-end {
    align-self: flex-end;
  }
</style>
