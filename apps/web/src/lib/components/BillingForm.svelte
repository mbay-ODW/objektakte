<script lang="ts">
  import type { components } from "$lib/api/schema";
  import { BILLING_TYPE_LABELS, DRAFT_TYPES, EINVOICE_FORMAT_LABELS } from "$lib/labels";
  import LineEditor from "./LineEditor.svelte";
  import SearchPicker, { type PickerOption } from "./SearchPicker.svelte";

  type Doc = components["schemas"]["BillingDocument"];

  let {
    doc = null,
    contacts,
    cases,
    articles,
    smallBusiness = false,
    defaults = {},
    dirty = $bindable(false),
  }: {
    doc?: Doc | null;
    contacts: PickerOption[];
    cases: PickerOption[];
    articles: components["schemas"]["Article"][];
    smallBusiness?: boolean;
    defaults?: { type?: string; contactId?: string; caseId?: string };
    dirty?: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally
  let type = $state<string>(doc?.type ?? defaults.type ?? "rechnung");
  // svelte-ignore state_referenced_locally
  let contactId = $state(doc?.contactId ?? defaults.contactId ?? "");
  // svelte-ignore state_referenced_locally
  let caseId = $state(doc?.caseId ?? defaults.caseId ?? "");

  const touch = () => (dirty = true);
  // Änderungen an den Auswahlfeldern zählen als ungespeichert.
  // svelte-ignore state_referenced_locally
  const initial = { contactId, caseId };
  $effect(() => {
    if (contactId !== initial.contactId || caseId !== initial.caseId) dirty = true;
  });
</script>

<div class="form-grid" oninput={touch} onchange={touch} role="presentation">
  {#if doc}
    <p class="full">
      <strong>{BILLING_TYPE_LABELS[doc.type]}</strong> (Entwurf)
    </p>
  {:else}
    <label
      >Belegart
      <select name="type" bind:value={type}>
        {#each DRAFT_TYPES as t (t)}<option value={t}>{BILLING_TYPE_LABELS[t]}</option>{/each}
      </select>
    </label>
  {/if}
  <SearchPicker name="contactId" label="Kunde" options={contacts} bind:value={contactId} required />
  <SearchPicker name="caseId" label="Vorgang (optional)" options={cases} bind:value={caseId} />
  <label>Rechnungsdatum <input type="date" name="issueDate" value={doc?.issueDate ?? ""} /></label>
  <label>Fällig am <input type="date" name="dueDate" value={doc?.dueDate ?? ""} /></label>
  <label>Leistungsdatum <input type="date" name="serviceDate" value={doc?.serviceDate ?? ""} /></label>
  <label
    >Leistungszeitraum von <input
      type="date"
      name="servicePeriodStart"
      value={doc?.servicePeriodStart ?? ""}
    /></label
  >
  <label
    >Leistungszeitraum bis <input
      type="date"
      name="servicePeriodEnd"
      value={doc?.servicePeriodEnd ?? ""}
    /></label
  >
  <label
    >Leitweg-ID / Käuferreferenz <input
      name="buyerReference"
      value={doc?.buyerReference ?? ""}
      placeholder="leer = Leitweg-ID des Kunden"
    /></label
  >
  <label>Bestellnummer <input name="orderReference" value={doc?.orderReference ?? ""} /></label>
  <label
    >E-Rechnung
    <select name="eInvoiceFormat" value={doc?.eInvoiceFormat ?? ""}>
      {#if !doc}<option value="">automatisch</option>{/if}
      {#each Object.entries(EINVOICE_FORMAT_LABELS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
    </select>
  </label>
  {#if type === "schlussrechnung"}
    <label
      >Bereits berechnete Abschläge brutto (€) <input
        name="prepaid"
        inputmode="decimal"
        placeholder="leer = automatisch"
        value={doc?.prepaidCents ? (doc.prepaidCents / 100).toFixed(2).replace(".", ",") : ""}
      /></label
    >
  {/if}
  <label class="full"
    >Einleitung <textarea name="intro" rows="2" placeholder="leer = Standardtext aus den Firmendaten"
      >{doc?.intro ?? ""}</textarea
    ></label
  >
  <label class="full"
    >Schlusstext <textarea name="closing" rows="2" placeholder="leer = Standardtext">{doc?.closing ?? ""}</textarea></label
  >
  <label class="full"
    >Zahlungsbedingungen <input
      name="paymentTermsText"
      value={doc?.paymentTermsText ?? ""}
      placeholder="leer = Zahlungsziel aus den Firmendaten"
    /></label
  >
</div>

<LineEditor lines={doc?.lines ?? []} {articles} {smallBusiness} onchange={touch} />
