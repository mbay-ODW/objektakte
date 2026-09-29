<script lang="ts">
  import type { components } from "$lib/api/schema";
  import { todayIso } from "$lib/format";
  import { CASE_STATUS_LABELS, CASE_STATUSES } from "$lib/labels";
  import SearchPicker, { type PickerOption } from "./SearchPicker.svelte";

  type Case = components["schemas"]["Case"];

  let {
    kase = null,
    measureTypes,
    contacts = null,
    objects = null,
    showNumber = false,
    customerId = "",
    objectId = "",
  }: {
    kase?: Partial<Case> | null;
    measureTypes: components["schemas"]["MeasureType"][];
    contacts?: PickerOption[] | null;
    objects?: PickerOption[] | null;
    showNumber?: boolean;
    customerId?: string;
    objectId?: string;
  } = $props();

  // svelte-ignore state_referenced_locally
  let customer = $state(kase?.customerId ?? customerId);
  // svelte-ignore state_referenced_locally
  let object = $state(kase?.objectId ?? objectId);
</script>

<div class="form-grid">
  <label class="full">Titel <input name="title" value={kase?.title ?? ""} required /></label>
  {#if contacts}
    <SearchPicker name="customerId" label="Kunde" options={contacts} bind:value={customer} required />
  {/if}
  {#if objects}
    <SearchPicker name="objectId" label="Objekt" options={objects} bind:value={object} />
  {/if}
  <label
    >Leistungsart
    <select name="measureCode" value={kase?.measureCode ?? ""}>
      <option value="">– keine –</option>
      {#each measureTypes.filter((m) => m.active || m.code === kase?.measureCode) as m (m.code)}
        <option value={m.code}>{m.code} – {m.name}</option>
      {/each}
    </select>
  </label>
  <label
    >Status
    <select name="status" value={kase?.status ?? "anfrage"}>
      {#each CASE_STATUSES as s (s)}<option value={s}>{CASE_STATUS_LABELS[s]}</option>{/each}
    </select>
  </label>
  {#if showNumber}
    <label
      >Vorgangsnummer <input name="number" placeholder="automatisch" value={kase?.number ?? ""} /></label
    >
  {/if}
  <label
    >Eröffnet am <input name="openedAt" type="date" value={kase?.openedAt ?? todayIso()} /></label
  >
  <label class="full"
    >Ablageordner <input name="storagePath" value={kase?.storagePath ?? ""} /></label
  >
  <label class="full">Notizen <textarea name="notes">{kase?.notes ?? ""}</textarea></label>
</div>
