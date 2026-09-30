<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Kontakte – objektakte</title></svelte:head>

<div class="spread">
  <h1>Kontakte</h1>
  <a class="button primary" href="/kontakte/neu">Neuer Kontakt</a>
</div>

<form method="get" class="row search" role="search">
  <label class="visually-hidden" for="q">Suche</label>
  <input id="q" name="q" type="search" value={data.q} placeholder="Name oder Kundennummer" />
  <button type="submit">Suchen</button>
</form>

<div class="card table-wrap">
  <table>
    <thead>
      <tr><th>Name</th><th>Kundennr.</th><th>Ort</th><th>Art</th></tr>
    </thead>
    <tbody>
      {#each data.contacts as c (c.id)}
        <tr>
          <td><a href="/kontakte/{c.id}">{c.displayName}</a></td>
          <td>{c.customerNumber ?? ""}</td>
          <td>{[c.postalCode, c.city].filter(Boolean).join(" ")}</td>
          <td>{c.kind === "organisation" ? "Organisation" : "Person"}</td>
        </tr>
      {:else}
        <tr><td colspan="4" class="muted">Keine Kontakte gefunden.</td></tr>
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
