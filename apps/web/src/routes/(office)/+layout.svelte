<script lang="ts">
  import { page } from "$app/state";

  let { children } = $props();

  const groups = [
    {
      label: "Arbeit",
      items: [
        { href: "/", label: "Übersicht" },
        { href: "/vorgaenge", label: "Vorgänge" },
        { href: "/inbox", label: "Inbox" },
        { href: "/fristen", label: "Fristen" },
        { href: "/vor-ort", label: "Vor Ort" },
      ],
    },
    {
      label: "Stammdaten",
      items: [
        { href: "/kontakte", label: "Kontakte" },
        { href: "/objekte", label: "Objekte" },
      ],
    },
    {
      label: "Finanzen",
      items: [
        { href: "/belege", label: "Belege" },
        { href: "/zahlungen", label: "Zahlungen" },
        { href: "/offene-posten", label: "Offene Posten" },
        { href: "/eingang", label: "Eingang" },
        { href: "/auswertungen", label: "Auswertungen" },
      ],
    },
    { label: "System", items: [{ href: "/einstellungen", label: "Einstellungen" }] },
  ];

  const isActive = (href: string) =>
    href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(href);
</script>

<a class="skip" href="#main">Zum Inhalt springen</a>
<header class="topbar">
  <a class="brand" href="/">objektakte</a>
  <nav aria-label="Hauptnavigation">
    {#each groups as group (group.label)}
      <div class="group" role="group" aria-labelledby="nav-{group.label}">
        <span class="group-label" id="nav-{group.label}">{group.label}</span>
        <ul>
          {#each group.items as item (item.href)}
            <li>
              <a href={item.href} aria-current={isActive(item.href) ? "page" : undefined}
                >{item.label}</a
              >
            </li>
          {/each}
        </ul>
      </div>
    {/each}
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
    display: flex;
    gap: 0.25rem 1rem;
    flex-wrap: wrap;
  }
  .group {
    display: flex;
    flex-direction: column;
  }
  .group-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    padding-left: 0.65rem;
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
  @media (max-width: 72rem) {
    nav {
      order: 3;
      flex-basis: 100%;
      flex-wrap: nowrap;
      overflow-x: auto;
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
