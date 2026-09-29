<script lang="ts">
  import { CATEGORIES, CATEGORY_LABELS, CONDITION_LABELS } from "$lib/labels";
  import type { ItemInput } from "$lib/offline/service";
  import type { LocalItem } from "$lib/offline/types";

  let {
    item = null,
    onsave,
    oncancel,
    ondelete,
  }: {
    item?: LocalItem | null;
    onsave: (input: ItemInput) => void | Promise<void>;
    oncancel: () => void;
    ondelete?: () => void;
  } = $props();

  const uid = $props.id();
  // svelte-ignore state_referenced_locally
  let category = $state<ItemInput["category"]>(item?.category ?? "aussenwand");
  // svelte-ignore state_referenced_locally
  let label = $state(item?.label ?? "");
  // svelte-ignore state_referenced_locally
  let location = $state(item?.location ?? "");
  // svelte-ignore state_referenced_locally
  let condition = $state<string>(item?.condition ?? "");
  // svelte-ignore state_referenced_locally
  let notes = $state(item?.notes ?? "");
  // svelte-ignore state_referenced_locally
  let attributes = $state(
    Object.entries(item?.attributes ?? {}).map(([key, value]) => ({ key, value })),
  );

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const attrs: Record<string, string> = {};
    for (const a of attributes) {
      const k = a.key.trim();
      if (k) attrs[k] = a.value.trim();
    }
    void onsave({
      id: item?.id,
      category,
      label: label.trim() || CATEGORY_LABELS[category],
      location: location.trim() || null,
      condition: (condition || null) as ItemInput["condition"],
      attributes: attrs,
      notes: notes.trim() || null,
    });
  }
</script>

<form class="editor stack" onsubmit={submit} aria-label="Position">
  <label
    >Kategorie
    <select bind:value={category} name="category">
      {#each CATEGORIES as c (c)}<option value={c}>{CATEGORY_LABELS[c]}</option>{/each}
    </select>
  </label>
  <label>Bezeichnung <input name="label" bind:value={label} placeholder={CATEGORY_LABELS[category]} /></label>
  <label>Lage / Raum <input name="location" bind:value={location} placeholder="z. B. Nordseite, EG" /></label>
  <fieldset class="row">
    <legend>Zustand</legend>
    {#each Object.entries(CONDITION_LABELS) as [value, text] (value)}
      <label class="inline chip"
        ><input type="radio" name="condition-{uid}" {value} bind:group={condition} /> {text}</label
      >
    {/each}
    <label class="inline chip"
      ><input type="radio" name="condition-{uid}" value="" bind:group={condition} /> keine Angabe</label
    >
  </fieldset>
  <fieldset class="stack">
    <legend>Merkmale</legend>
    {#each attributes as a, i (i)}
      <div class="attr">
        <input aria-label="Merkmal" placeholder="Merkmal (z. B. Material)" bind:value={a.key} />
        <input aria-label="Wert" placeholder="Wert" bind:value={a.value} />
        <button
          type="button"
          class="small"
          aria-label="Merkmal entfernen"
          onclick={() => (attributes = attributes.filter((_, j) => j !== i))}>✕</button
        >
      </div>
    {/each}
    <div>
      <button
        type="button"
        class="small"
        onclick={() => (attributes = [...attributes, { key: "", value: "" }])}>+ Merkmal</button
      >
    </div>
  </fieldset>
  <label>Notizen <textarea name="notes" bind:value={notes} rows="3"></textarea></label>
  <div class="row">
    <button type="submit" class="primary">Position speichern</button>
    <button type="button" onclick={oncancel}>Abbrechen</button>
    {#if ondelete}
      <button type="button" class="danger" onclick={ondelete}>Löschen</button>
    {/if}
  </div>
</form>

<style>
  .editor {
    background: var(--surface-2);
    border-radius: var(--radius);
    padding: 0.75rem;
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
  }
  legend {
    font-weight: 500;
    font-size: 0.9rem;
    margin-bottom: 0.25rem;
  }
  .chip {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.35rem 0.75rem;
    background: var(--surface);
    min-height: 2.5rem;
  }
  .attr {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 0.4rem;
  }
</style>
