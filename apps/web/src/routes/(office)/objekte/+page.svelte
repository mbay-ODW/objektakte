<script lang="ts">
  import { USAGE_LABELS } from "$lib/labels";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Objekte – objektakte</title></svelte:head>

<div class="spread">
  <h1>Objekte</h1>
  <a class="button primary" href="/objekte/neu">Neues Objekt</a>
</div>

<form method="get" class="row search" role="search">
  <label class="visually-hidden" for="q">Suche</label>
  <input id="q" name="q" type="search" value={data.q} placeholder="Bezeichnung, Straße oder Ort" />
  <button type="submit">Suchen</button>
</form>

<div class="card table-wrap">
  <table>
    <thead>
      <tr><th>Bezeichnung</th><th>Anschrift</th><th>Nutzung</th><th>Baujahr</th></tr>
    </thead>
    <tbody>
      {#each data.objects as o (o.id)}
        <tr>
          <td><a href="/objekte/{o.id}">{o.label}</a></td>
          <td>{[o.street, [o.postalCode, o.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</td>
          <td>{USAGE_LABELS[o.usage]}</td>
          <td>{o.constructionYear ?? ""}</td>
        </tr>
      {:else}
        <tr><td colspan="4" class="muted">Keine Objekte gefunden.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .search {
    margin: 0.5rem 0 1rem;
    flex-wrap: nowrap;
  }
</style>
