<script lang="ts">
  import { page } from "$app/state";

  let { children } = $props();
  const nav = [
    ["/einstellungen", "Kommunikation"],
    ["/einstellungen/leistungsarten", "Leistungsarten"],
    ["/einstellungen/nummernkreise", "Nummernkreise"],
    ["/einstellungen/foerderprogramme", "Förderprogramme"],
    ["/einstellungen/fristenregeln", "Fristenregeln"],
    ["/einstellungen/webhooks", "Webhooks"],
  ];
</script>

<h1>Einstellungen</h1>
<nav class="subnav" aria-label="Einstellungen">
  {#each nav as [href, label] (href)}
    <a {href} aria-current={page.url.pathname === href ? "page" : undefined}>{label}</a>
  {/each}
</nav>
{@render children()}

<style>
  .subnav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 1rem;
  }
  .subnav a {
    padding: 0.35rem 0.7rem;
    border-radius: 6px;
    text-decoration: none;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .subnav a[aria-current="page"] {
    background: var(--primary-soft);
    border-color: var(--primary);
    font-weight: 600;
  }
</style>
