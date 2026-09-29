<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import { keepValues } from "$lib/enhance";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const c = $derived(data.company);
  const patterns = [
    ["rechnung", "Rechnungen, Gutschriften, Stornos"],
    ["angebot", "Angebote"],
    ["auftragsbestaetigung", "Auftragsbestätigungen"],
    ["zahlungserinnerung", "Zahlungserinnerungen"],
  ] as const;
</script>

<svelte:head><title>Firmendaten – objektakte</title></svelte:head>

<form method="post" class="stack" use:enhance={keepValues}>
  <FormError {form} />
  {#if form && "saved" in form}<p class="success" role="status">Gespeichert. Gilt für künftig festgeschriebene Belege.</p>{/if}

  <section class="card">
    <h2>Firma</h2>
    <div class="form-grid">
      <label class="full">Name <input name="name" value={c.name} required /></label>
      <label class="full">Straße <input name="street" value={c.street} /></label>
      <label>PLZ <input name="postalCode" value={c.postalCode} /></label>
      <label>Ort <input name="city" value={c.city} /></label>
      <label>Land <input name="country" value={c.country} maxlength="2" /></label>
      <label>Ansprechpartner <input name="contactName" value={c.contactName} /></label>
      <label>E-Mail <input name="email" type="email" value={c.email} /></label>
      <label>Telefon <input name="phone" value={c.phone} /></label>
      <label>Website <input name="website" value={c.website ?? ""} /></label>
    </div>
  </section>

  <section class="card">
    <h2>Steuer</h2>
    <div class="form-grid">
      <label>USt-IdNr. <input name="vatId" value={c.vatId ?? ""} placeholder="DE…" /></label>
      <label>Steuernummer <input name="taxNumber" value={c.taxNumber ?? ""} /></label>
      <label
        >Verkäuferkennung (BT-29) <input
          name="sellerId"
          value={c.sellerId ?? ""}
          placeholder="nötig ohne USt-IdNr."
        /></label
      >
      <label class="inline full"
        ><input type="checkbox" name="smallBusiness" checked={c.smallBusiness} /> Kleinunternehmer nach § 19 UStG
        (keine Umsatzsteuer)</label
      >
    </div>
  </section>

  <section class="card">
    <h2>Bankverbindung und Zahlungsziel</h2>
    <div class="form-grid">
      <label>Bank <input name="bankName" value={c.bankName ?? ""} /></label>
      <label>IBAN <input name="iban" value={c.iban ?? ""} /></label>
      <label>BIC <input name="bic" value={c.bic ?? ""} /></label>
      <label>Zahlungsziel (Tage) <input name="paymentDays" type="number" min="0" max="120" value={c.paymentDays} /></label>
    </div>
  </section>

  <section class="card">
    <h2>Nummernkreise</h2>
    <p class="small muted">Platzhalter: <code>{"{YYYY}"}</code> Jahr, <code>{"{N}"}</code> laufende Nummer. Startwerte unter <a href="/einstellungen/nummernkreise">Nummernkreise</a>.</p>
    <div class="form-grid">
      {#each patterns as [key, label] (key)}
        <label>{label} <input name="pattern_{key}" value={c.numberPatterns[key]} /></label>
      {/each}
    </div>
  </section>

  <section class="card">
    <h2>Standardtexte</h2>
    <div class="form-grid">
      <label class="full">Rechnung – Einleitung <textarea name="invoiceIntro" rows="2">{c.texts.invoiceIntro}</textarea></label>
      <label class="full">Rechnung – Schluss <textarea name="invoiceClosing" rows="2">{c.texts.invoiceClosing}</textarea></label>
      <label class="full">Angebot – Einleitung <textarea name="offerIntro" rows="2">{c.texts.offerIntro}</textarea></label>
      <label class="full">Angebot – Schluss <textarea name="offerClosing" rows="2">{c.texts.offerClosing}</textarea></label>
      {#each [0, 1, 2] as i (i)}
        <label class="full">Mahnstufe {i + 1} <textarea name="reminder{i + 1}" rows="2">{c.texts.reminder[i] ?? ""}</textarea></label>
      {/each}
    </div>
  </section>

  <div><button type="submit" class="primary">Firmendaten speichern</button></div>
</form>
