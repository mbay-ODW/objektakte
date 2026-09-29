<script lang="ts">
  import type { components } from "$lib/api/schema";
  import { CHANNEL_KIND_LABELS, CHANNEL_KINDS } from "$lib/labels";

  type Contact = components["schemas"]["ContactDetail"];
  interface ChannelRow {
    kind: string;
    value: string;
    label: string;
  }

  let {
    contact = null,
    prefix = "",
    showChannels = true,
  }: { contact?: Partial<Contact> | null; prefix?: string; showChannels?: boolean } = $props();

  // svelte-ignore state_referenced_locally
  let kind = $state(contact?.kind ?? "person");
  // svelte-ignore state_referenced_locally
  let channels = $state<ChannelRow[]>(
    contact?.channels?.map((c) => ({ kind: c.kind, value: c.value, label: c.label ?? "" })) ?? [
      { kind: "email", value: "", label: "" },
    ],
  );
  // svelte-ignore state_referenced_locally
  let primary = $state(String(contact?.channels?.findIndex((c) => c.isPrimary) ?? 0));

  const n = (name: string) => `${prefix}${name}`;
</script>

<div class="form-grid">
  <fieldset class="full row kind">
    <legend>Art</legend>
    <label class="inline"
      ><input type="radio" name={n("kind")} value="person" bind:group={kind} /> Person</label
    >
    <label class="inline"
      ><input type="radio" name={n("kind")} value="organisation" bind:group={kind} /> Organisation</label
    >
  </fieldset>
  {#if kind === "organisation"}
    <label class="full"
      >Organisation <input
        name={n("organisationName")}
        value={contact?.organisationName ?? ""}
        required
      /></label
    >
  {:else}
    <label>Anrede <input name={n("salutation")} value={contact?.salutation ?? ""} /></label>
    <label>Vorname <input name={n("firstName")} value={contact?.firstName ?? ""} /></label>
    <label>Nachname <input name={n("lastName")} value={contact?.lastName ?? ""} required /></label>
  {/if}
  <label
    >Anzeigename <input
      name={n("displayName")}
      value={contact?.displayName ?? ""}
      placeholder="automatisch"
    /></label
  >
  <label>Kundennummer <input name={n("customerNumber")} value={contact?.customerNumber ?? ""} /></label>
  <label class="full">Straße <input name={n("street")} value={contact?.street ?? ""} /></label>
  <label>PLZ <input name={n("postalCode")} value={contact?.postalCode ?? ""} /></label>
  <label>Ort <input name={n("city")} value={contact?.city ?? ""} /></label>
  <label
    >Land <input name={n("country")} value={contact?.country ?? "DE"} maxlength="2" /></label
  >
  <label
    >Leitweg-ID <input
      name={n("leitwegId")}
      value={contact?.leitwegId ?? ""}
      placeholder="z. B. 991-12345-67"
    /></label
  >
  <label>USt-IdNr. <input name={n("vatId")} value={contact?.vatId ?? ""} /></label>
  <label class="full">Notizen <textarea name={n("notes")}>{contact?.notes ?? ""}</textarea></label>
</div>

{#if showChannels}
  <fieldset class="channels">
    <legend>Kommunikationskanäle</legend>
    {#each channels as ch, i (i)}
      <div class="channel">
        <label
          ><span class="visually-hidden">Art</span>
          <select name={n("channel_kind")} bind:value={ch.kind} aria-label="Kanalart">
            {#each CHANNEL_KINDS as k (k)}<option value={k}>{CHANNEL_KIND_LABELS[k]}</option>{/each}
          </select>
        </label>
        <label
          ><span class="visually-hidden">Adresse/Nummer</span>
          <input
            name={n("channel_value")}
            bind:value={ch.value}
            placeholder="Adresse oder Nummer"
            aria-label="Adresse oder Nummer"
          />
        </label>
        <label
          ><span class="visually-hidden">Bezeichnung</span>
          <input
            name={n("channel_label")}
            bind:value={ch.label}
            placeholder="Bezeichnung"
            aria-label="Bezeichnung"
          />
        </label>
        <label class="inline"
          ><input type="radio" name={n("channel_primary")} value={String(i)} bind:group={primary} />
          primär</label
        >
        <button
          type="button"
          class="small"
          onclick={() => (channels = channels.filter((_, j) => j !== i))}
          aria-label="Kanal entfernen">✕</button
        >
      </div>
    {/each}
    <button
      type="button"
      class="small"
      onclick={() => (channels = [...channels, { kind: "email", value: "", label: "" }])}
      >+ Kanal</button
    >
  </fieldset>
{/if}

<style>
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem 0.75rem;
    margin: 0.75rem 0 0;
  }
  fieldset.kind {
    margin: 0;
  }
  .channel {
    display: grid;
    grid-template-columns: 8rem 1fr 10rem auto auto;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  @media (max-width: 40rem) {
    .channel {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
