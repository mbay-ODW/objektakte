<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import { keepValues } from "$lib/enhance";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const csv = $derived(data.bank.csv);
  const columns = [
    ["bookingDate", "Buchungstag", true],
    ["valueDate", "Valuta", false],
    ["amount", "Betrag", true],
    ["debitCredit", "Soll/Haben-Kennzeichen", false],
    ["currency", "Währung", false],
    ["counterpartyName", "Name Zahlungsbeteiligter", false],
    ["counterpartyIban", "IBAN Zahlungsbeteiligter", false],
    ["purpose", "Verwendungszweck", true],
    ["reference", "Referenz", false],
    ["externalId", "Eindeutige Umsatz-ID", false],
  ] as const;
</script>

<svelte:head><title>Bank-CSV – objektakte</title></svelte:head>

<form method="post" class="stack" use:enhance={keepValues}>
  <FormError {form} />
  {#if form && "saved" in form}<p class="success" role="status">Gespeichert.</p>{/if}
  <section class="card">
    <h2>Automatischer Abgleich</h2>
    <label
      >Ab dieser Sicherheit automatisch zuordnen (0–1)
      <input name="autoAllocateThreshold" type="number" step="0.05" min="0" max="1" value={data.bank.autoAllocateThreshold} />
    </label>
  </section>
  <section class="card">
    <h2>CSV-Format</h2>
    <div class="form-grid">
      <label
        >Trennzeichen
        <select name="delimiter" value={csv.delimiter === "\t" ? "tab" : csv.delimiter}>
          <option value=";">Semikolon (;)</option>
          <option value=",">Komma (,)</option>
          <option value="tab">Tabulator</option>
        </select>
      </label>
      <label
        >Datumsformat
        <select name="dateFormat" value={csv.dateFormat}>
          <option value="dd.mm.yyyy">TT.MM.JJJJ</option>
          <option value="yyyy-mm-dd">JJJJ-MM-TT</option>
        </select>
      </label>
      <label
        >Dezimaltrennzeichen
        <select name="decimal" value={csv.decimal}>
          <option value=",">Komma</option>
          <option value=".">Punkt</option>
        </select>
      </label>
      <label>Vorspannzeilen überspringen <input name="skipLines" type="number" min="0" value={csv.skipLines} /></label>
    </div>
  </section>
  <section class="card">
    <h2>Spaltenüberschriften</h2>
    <p class="small muted">Genau so, wie sie in der Kopfzeile der CSV-Datei stehen. Leer = Standardbezeichnung; fehlende optionale Spalten werden ignoriert.</p>
    <div class="form-grid">
      {#each columns as [key, label, required] (key)}
        <label>{label}{required ? " *" : ""}
          <input name="col_{key}" value={(csv.columns as Record<string, string | undefined>)[key] ?? ""} {required} />
        </label>
      {/each}
    </div>
  </section>
  <div><button type="submit" class="primary">Speichern</button></div>
</form>
