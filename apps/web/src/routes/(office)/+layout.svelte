<script lang="ts">
  import { page } from "$app/state";

  let { children } = $props();

  const nav = [
    { href: "/", label: "Übersicht" },
    { href: "/vorgaenge", label: "Vorgänge" },
    { href: "/kontakte", label: "Kontakte" },
    { href: "/objekte", label: "Objekte" },
    { href: "/fristen", label: "Fristen" },
    { href: "/inbox", label: "Inbox" },
    { href: "/einstellungen", label: "Einstellungen" },
  ];

  const isActive = (href: string) =>
    href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(href);
</script>

<a class="skip" href="#main">Zum Inhalt springen</a>
<header class="topbar">
  <a class="brand" href="/">objektakte</a>
  <nav aria-label="Hauptnavigation">
    <ul>
      {#each nav as item (item.href)}
        <li>
          <a href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>{item.label}</a>
        </li>
      {/each}
      <li><a href="/vor-ort" class="vor-ort">Vor Ort</a></li>
    </ul>
  </nav>
  <form method="post" action="/logout">
    <button type="submit" class="small">Abmelden</button>
  </form>
</header>

<main id="main">
  {@render children()}
</main>

<style>
  .skip {
    position: absolute;
    left: -999px;
  }
  .skip:focus {
    left: 1rem;
    top: 0.5rem;
    z-index: 10;
    background: var(--surface);
    padding: 0.5rem;
  }
  .topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.5rem 1rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .brand {
    font-weight: 700;
    color: var(--text);
    text-decoration: none;
    font-size: 1.05rem;
  }
  nav {
    flex: 1;
    overflow-x: auto;
  }
  nav ul {
    display: flex;
    gap: 0.25rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  nav a {
    display: block;
    padding: 0.4rem 0.65rem;
    border-radius: 6px;
    color: var(--text);
    text-decoration: none;
    white-space: nowrap;
  }
  nav a[aria-current="page"] {
    background: var(--primary-soft);
    color: var(--primary);
    font-weight: 600;
  }
  nav a.vor-ort {
    border: 1px solid var(--primary);
    color: var(--primary);
  }
  @media (max-width: 52rem) {
    nav {
      order: 3;
      flex-basis: 100%;
    }
    form {
      margin-left: auto;
    }
  }
  main {
    max-width: 80rem;
    margin: 0 auto;
    padding: 1rem;
  }
</style>
