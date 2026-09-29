<script lang="ts">
  import { enhance } from "$app/forms";
  import BillingForm from "$lib/components/BillingForm.svelte";
  import BillingStatusBadge from "$lib/components/BillingStatusBadge.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import FormError from "$lib/components/FormError.svelte";
  import { formatCents, formatDate, formatDateTime } from "$lib/format";
  import {
    BILLING_TYPE_LABELS,
    DRAFT_TYPES,
    EINVOICE_FORMAT_LABELS,
    INVOICE_TYPES,
    TAX_CATEGORY_LABELS,
    UNIT_LABELS,
  } from "$lib/labels";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const d = $derived(data.doc);
  const isDraft = $derived(d.status === "entwurf");
  const isInvoice = $derived(INVOICE_TYPES.includes(d.type));
  const validation = $derived(
    d.validation as {
      mode?: string;
      valid?: boolean;
      errors?: string[];
      warnings?: string[];
      validator?: string | null;
    } | null,
  );
  let dirty = $state(false);
  const problems = $derived(data.check?.problems ?? []);
  const convertTargets = $derived(
    d.type === "angebot"
      ? (["auftragsbestaetigung", "rechnung", "abschlagsrechnung"] as const)
      : d.type === "auftragsbestaetigung"
        ? (["rechnung", "abschlagsrechnung", "schlussrechnung"] as const)
        : DRAFT_TYPES,
  );
  const title = $derived(`${BILLING_TYPE_LABELS[d.type]} ${d.number ?? "(Entwurf)"}`);
</script>

<svelte:head><title>{title} – objektakte</title></svelte:head>

<div class="spread">
  <div>
    <h1>{title}</h1>
    <p class="row meta">
      <BillingStatusBadge status={d.status} />
      <a href="/kontakte/{d.contactId}">{d.contactName}</a>
      {#if d.caseId}· <a href="/vorgaenge/{d.caseId}">Vorgang</a>{/if}
      {#if d.eInvoiceFormat !== "keine"}<span class="badge info">{EINVOICE_FORMAT_LABELS[d.eInvoiceFormat]}</span>{/if}
    </p>
  </div>
  <a href="/belege">Alle Belege</a>
</div>

<FormError {form} />
{#if form && "done" in form}<p class="success" role="status">{form.done}</p>{/if}

{#if isDraft && data.editor}
  <section class="card stack" aria-labelledby="check-h">
    <h2 id="check-h">Vorprüfung</h2>
    {#if data.checkError}
      <p class="error">{data.checkError}</p>
    {:else if problems.length > 0}
      <div class="problems" role="alert" data-testid="check-problems">
        <strong>{problems.length} Problem(e) verhindern das Festschreiben:</strong>
        <ul>
          {#each problems as p (p.rule + p.message)}
            <li>{p.message} <span class="small muted">[{p.rule}]</span></li>
          {/each}
        </ul>
      </div>
    {:else}
      <p class="success" data-testid="check-ok">Keine Probleme gefunden – der Entwurf kann festgeschrieben werden.</p>
    {/if}
    {#if data.check}
      <dl class="facts">
        <dt>Netto</dt><dd>{formatCents(data.check.netCents)}</dd>
        <dt>Umsatzsteuer</dt><dd>{formatCents(data.check.taxCents)}</dd>
        <dt>Brutto</dt><dd><strong>{formatCents(data.check.grossCents)}</strong></dd>
        {#if data.check.duePayableCents !== data.check.grossCents}
          <dt>Zahlbetrag</dt><dd>{formatCents(data.check.duePayableCents)}</dd>
        {/if}
      </dl>
      <p class="small muted">Stand des gespeicherten Entwurfs.</p>
    {/if}
    <div class="row">
      <a class="button" href="/belege/{d.id}/vorschau" target="_blank" rel="noopener">PDF-Vorschau</a>
      <ConfirmDialog
        trigger="Festschreiben …"
        triggerClass="primary"
        title="Beleg endgültig festschreiben?"
        action="?/finalize"
        confirmLabel="Endgültig festschreiben"
        disabled={dirty || problems.length > 0}
        acknowledge="Ich habe Empfänger, Positionen und Beträge geprüft."
      >
        <p>
          Festschreiben ist <strong>nicht umkehrbar</strong>. Der Beleg erhält die nächste fortlaufende
          Nummer, E-Rechnung und PDF werden erzeugt, geprüft und in der Ablage gespeichert.
        </p>
        <p>
          Danach ist der Beleg nach den GoBD unveränderlich und kann nicht gelöscht werden. Fehler
          lassen sich nur noch durch eine Stornorechnung korrigieren.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        trigger="Entwurf löschen"
        triggerClass="danger"
        title="Entwurf löschen?"
        action="?/delete"
        confirmLabel="Löschen"
        danger
      >
        <p>Der Entwurf wird entfernt. Es wurde noch keine Nummer vergeben.</p>
      </ConfirmDialog>
    </div>
    {#if dirty}<p class="small warn-note">Ungespeicherte Änderungen – vor dem Festschreiben speichern.</p>{/if}
  </section>

  <form
    method="post"
    action="?/save"
    class="card stack"
    use:enhance={() =>
      async ({ update, result }) => {
        await update({ reset: false });
        if (result.type === "success") dirty = false;
      }}
  >
    <h2>Entwurf bearbeiten</h2>
    <BillingForm
      doc={d}
      contacts={data.editor.contacts}
      cases={data.editor.cases}
      articles={data.editor.articles}
      smallBusiness={data.editor.smallBusiness}
      bind:dirty
    />
    <div><button type="submit" class="primary">Entwurf speichern</button></div>
  </form>
{:else}
  <div class="grid">
    <section class="card">
      <h2>Beleg</h2>
      <dl class="facts">
        <dt>Datum</dt><dd>{formatDate(d.issueDate)}</dd>
        {#if d.dueDate}<dt>Fällig</dt><dd>{formatDate(d.dueDate)}</dd>{/if}
        {#if d.serviceDate}<dt>Leistungsdatum</dt><dd>{formatDate(d.serviceDate)}</dd>{/if}
        {#if d.servicePeriodStart}<dt>Leistungszeitraum</dt><dd>{formatDate(d.servicePeriodStart)} – {formatDate(d.servicePeriodEnd)}</dd>{/if}
        {#if d.buyerReference}<dt>Leitweg-ID / Referenz</dt><dd class="mono">{d.buyerReference}</dd>{/if}
        {#if d.orderReference}<dt>Bestellnummer</dt><dd>{d.orderReference}</dd>{/if}
        <dt>Festgeschrieben</dt><dd>{formatDateTime(d.finalizedAt)}</dd>
        {#if d.sentAt}<dt>Versendet</dt><dd>{formatDateTime(d.sentAt)}{d.sentVia ? ` (${d.sentVia})` : ""}</dd>{/if}
        {#if d.reminderLevel}<dt>Mahnstufe</dt><dd>{d.reminderLevel}</dd>{/if}
        {#if d.contentHash}<dt>SHA-256</dt><dd class="mono small hash">{d.contentHash}</dd>{/if}
      </dl>
      <div class="row downloads">
        {#if d.pdfDocumentId}
          <a class="button" href="/dokumente/{d.pdfDocumentId}" target="_blank" rel="noopener" data-testid="pdf-link">PDF öffnen</a>
          <a class="button" href="/dokumente/{d.pdfDocumentId}?download">PDF herunterladen</a>
        {/if}
        {#if d.xmlDocumentId}
          <a class="button" href="/dokumente/{d.xmlDocumentId}?download">XML herunterladen</a>
        {/if}
      </div>
    </section>

    <section class="card">
      <h2>Beträge</h2>
      <dl class="facts">
        <dt>Netto</dt><dd>{formatCents(d.netCents)}</dd>
        <dt>Umsatzsteuer</dt><dd>{formatCents(d.taxCents)}</dd>
        <dt>Brutto</dt><dd><strong>{formatCents(d.grossCents)}</strong></dd>
        {#if d.prepaidCents}<dt>Abzüglich Abschläge</dt><dd>{formatCents(d.prepaidCents)}</dd>{/if}
        {#if data.receivable}
          <dt>Bezahlt</dt><dd>{formatCents(data.receivable.paidCents)}</dd>
          <dt>Offen</dt>
          <dd>
            <strong>{formatCents(data.receivable.openCents)}</strong>
            {#if data.receivable.daysOverdue > 0}<span class="badge danger">{data.receivable.daysOverdue} Tage überfällig</span>{/if}
          </dd>
        {:else if isInvoice && d.status !== "storniert"}
          <dt>Offen</dt><dd><span class="badge ok">bezahlt</span></dd>
        {/if}
      </dl>
    </section>

    <section class="card">
      <h2>Prüfung der E-Rechnung</h2>
      {#if !validation || d.eInvoiceFormat === "keine"}
        <p class="muted">Keine E-Rechnung.</p>
      {:else}
        <p>
          {#if validation.valid}<span class="badge ok">gültig</span>{:else}<span class="badge danger">ungültig</span>{/if}
          <span class="small muted">{validation.validator ?? "interne Vorprüfung"} ({validation.mode})</span>
        </p>
        {#if validation.errors?.length}<ul class="small">{#each validation.errors as e (e)}<li class="error">{e}</li>{/each}</ul>{/if}
        {#if validation.warnings?.length}<ul class="small">{#each validation.warnings as w (w)}<li>{w}</li>{/each}</ul>{/if}
      {/if}
    </section>
  </div>

  <section class="card stack">
    <h2>Aktionen</h2>
    <div class="actions">
      {#if d.status === "festgeschrieben"}
        <form method="post" action="?/sent" class="row" use:enhance>
          <label class="inline">Versandweg
            <select name="via">
              <option>E-Mail</option>
              <option>Post</option>
              <option>Portal</option>
              <option>persönlich</option>
            </select>
          </label>
          <button type="submit">Als versendet markieren</button>
        </form>
      {/if}
      {#if d.type !== "stornorechnung" && d.type !== "zahlungserinnerung"}
        <form method="post" action="?/convert" class="row">
          <label class="inline">Übernehmen als
            <select name="type">
              {#each convertTargets as t (t)}<option value={t}>{BILLING_TYPE_LABELS[t]}</option>{/each}
            </select>
          </label>
          <button type="submit">{d.type === "angebot" ? "In Rechnung umwandeln" : "Als neuen Entwurf übernehmen"}</button>
        </form>
      {/if}
      {#if data.receivable}
        <form method="post" action="?/reminder" class="row reminder">
          <label>Stufe
            <select name="level">
              <option value="1">1 – Zahlungserinnerung</option>
              <option value="2">2 – Mahnung</option>
              <option value="3">3 – letzte Mahnung</option>
            </select>
          </label>
          <label>Gebühr (€) <input name="fee" inputmode="decimal" value="0,00" /></label>
          <label>Frist (Tage) <input name="dueDays" type="number" min="1" max="60" value="10" /></label>
          <button type="submit">Zahlungserinnerung erzeugen</button>
        </form>
      {/if}
      {#if isInvoice && (d.status === "festgeschrieben" || d.status === "versendet")}
        <ConfirmDialog
          trigger="Stornieren …"
          triggerClass="danger"
          title="Rechnung stornieren?"
          action="?/cancel"
          confirmLabel="Stornorechnung festschreiben"
          danger
          acknowledge="Ich möchte diese Rechnung stornieren."
        >
          <p>
            Es wird eine <strong>Stornorechnung</strong> mit Bezug auf {d.number} erzeugt und sofort
            festgeschrieben. Die Rechnung erhält den Status „storniert“. Das lässt sich nicht
            rückgängig machen.
          </p>
        </ConfirmDialog>
      {/if}
    </div>
    {#if data.related.length > 0}
      <h3>Verknüpfte Belege</h3>
      <ul class="plain">
        {#each data.related as r (r.id)}
          <li><a href="/belege/{r.id}">{BILLING_TYPE_LABELS[r.type]} {r.number ?? "(Entwurf)"}</a> <BillingStatusBadge status={r.status} /></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card table-wrap">
    <h2>Positionen</h2>
    <table>
      <thead>
        <tr><th>Pos.</th><th>Bezeichnung</th><th class="num">Menge</th><th>Einheit</th><th class="num">Einzelpreis</th><th>Steuer</th></tr>
      </thead>
      <tbody>
        {#each d.lines as l (l.position)}
          <tr>
            <td>{l.position}</td>
            <td>{l.name}{#if l.description}<div class="small muted">{l.description}</div>{/if}</td>
            <td class="num">{l.quantity.toLocaleString("de-DE")}</td>
            <td>{UNIT_LABELS[l.unitCode] ?? l.unitCode}</td>
            <td class="num nowrap">{formatCents(l.unitPriceCents)}</td>
            <td class="small">{l.taxCategory === "S" ? `${l.taxRatePercent} %` : TAX_CATEGORY_LABELS[l.taxCategory]}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  .meta {
    margin: 0;
  }
  .hash {
    word-break: break-all;
  }
  .downloads {
    margin-top: 0.75rem;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .reminder {
    align-items: flex-end;
  }
  .reminder label {
    max-width: 14rem;
  }
  .warn-note {
    color: var(--warn);
    margin: 0;
  }
</style>
