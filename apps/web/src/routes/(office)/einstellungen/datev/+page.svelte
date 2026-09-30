<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import { keepValues } from "$lib/enhance";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const d = $derived(data.datev);
</script>

<svelte:head><title>DATEV – objektakte</title></svelte:head>

<form method="post" class="card stack" use:enhance={keepValues}>
  <h2>DATEV-Export</h2>
  <FormError {form} />
  {#if form && "saved" in form}<p class="success" role="status">Gespeichert.</p>{/if}
  <p class="small muted">
    Standardkonten nach SKR03. Vor produktiver Nutzung einen Probeimport mit der Steuerberatung
    abstimmen.
  </p>
  <div class="form-grid">
    <label>Beraternummer <input name="consultantNumber" type="number" min="1000" max="9999999" value={d.consultantNumber ?? ""} /></label>
    <label>Mandantennummer <input name="clientNumber" type="number" min="1" max="99999" value={d.clientNumber ?? ""} /></label>
    <label>Beginn Wirtschaftsjahr (MM-TT) <input name="fiscalYearStart" value={d.fiscalYearStart} pattern={"\\d{2}-\\d{2}"} /></label>
    <label>Sachkontenlänge <input name="accountLength" type="number" min="4" max="8" value={d.accountLength} /></label>
    <label
      >Buchungsmodus
      <select name="mode" value={d.mode}>
        <option value="ist">Ist (bei Zahlungseingang, EÜR)</option>
        <option value="soll">Soll (bei Rechnungsstellung)</option>
      </select>
    </label>
    <label>Bankkonto <input name="bankAccount" type="number" value={d.bankAccount} /></label>
    <label>Sammeldebitor <input name="debtorAccount" type="number" value={d.debtorAccount} /></label>
    <label>Erlöse Regelsteuersatz <input name="revStandard" type="number" value={d.revenueAccounts.standard} /></label>
    <label>Erlöse 7 % <input name="revReduced" type="number" value={d.revenueAccounts.reduced} /></label>
    <label>Erlöse Reverse Charge <input name="revReverseCharge" type="number" value={d.revenueAccounts.reverseCharge} /></label>
    <label>Erlöse steuerfrei <input name="revExempt" type="number" value={d.revenueAccounts.exempt} /></label>
  </div>
  <div><button type="submit" class="primary">Speichern</button></div>
</form>
