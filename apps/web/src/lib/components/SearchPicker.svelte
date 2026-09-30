<script lang="ts" module>
  export interface PickerOption {
    id: string;
    label: string;
    hint?: string | null;
  }
</script>

<script lang="ts">
  /** Durchsuchbare Auswahl: filtert eine Optionsliste per Texteingabe und schreibt die ID in ein
   * verstecktes Feld. */
  let {
    name,
    options,
    label,
    value = $bindable(""),
    required = false,
    placeholder = "Suchen …",
    id = undefined,
  }: {
    name: string;
    options: PickerOption[];
    label: string;
    value?: string;
    required?: boolean;
    placeholder?: string;
    id?: string;
  } = $props();

  const uid = $props.id();
  const inputId = $derived(id ?? `picker-${uid}`);

  let query = $state("");
  let open = $state(false);
  let active = $state(0);

  const selected = $derived(options.find((o) => o.id === value));
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q))
      : options;
    return list.slice(0, 30);
  });

  function choose(o: PickerOption) {
    value = o.id;
    query = "";
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      open = true;
      active = Math.min(active + 1, matches.length - 1);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      active = Math.max(active - 1, 0);
      e.preventDefault();
    } else if (e.key === "Enter" && open) {
      const m = matches[active];
      if (m) choose(m);
      e.preventDefault();
    } else if (e.key === "Escape") {
      open = false;
    }
  }
</script>

<div class="picker">
  <label for={inputId}>{label}</label>
  <input type="hidden" {name} {value} />
  {#if selected}
    <div class="selected">
      <span>{selected.label}{#if selected.hint}<span class="muted small"> · {selected.hint}</span>{/if}</span>
      <button type="button" class="small" onclick={() => (value = "")} aria-label="Auswahl entfernen"
        >Ändern</button
      >
    </div>
  {:else}
    <input
      id={inputId}
      type="search"
      role="combobox"
      aria-expanded={open}
      aria-controls="{inputId}-list"
      aria-autocomplete="list"
      autocomplete="off"
      {placeholder}
      {required}
      bind:value={query}
      onfocus={() => (open = true)}
      oninput={() => {
        open = true;
        active = 0;
      }}
      onblur={() => setTimeout(() => (open = false), 150)}
      onkeydown={onKey}
    />
    {#if open}
      <ul id="{inputId}-list" role="listbox" class="options">
        {#each matches as o, i (o.id)}
          <li role="option" aria-selected={i === active}>
            <button type="button" class:active={i === active} onmousedown={() => choose(o)}>
              {o.label}{#if o.hint}<span class="muted small"> · {o.hint}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="muted small empty">Keine Treffer</li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .picker {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .picker > label {
    font-weight: 500;
    font-size: 0.9rem;
  }
  .selected {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.3rem 0.3rem 0.3rem 0.6rem;
    background: var(--primary-soft);
    min-height: 2.5rem;
  }
  .options {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 20;
    list-style: none;
    margin: 0.2rem 0 0;
    padding: 0.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    max-height: 16rem;
    overflow-y: auto;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  }
  .options button {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    min-height: 2.2rem;
    font-weight: 400;
    white-space: normal;
    justify-content: flex-start;
  }
  .options button.active,
  .options button:hover {
    background: var(--primary-soft);
  }
  .empty {
    padding: 0.4rem;
  }
</style>
