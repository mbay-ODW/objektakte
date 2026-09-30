<script lang="ts">
  import { enhance } from "$app/forms";
  import type { components } from "$lib/api/schema";
  import ContactForm from "$lib/components/ContactForm.svelte";
  import FormError from "$lib/components/FormError.svelte";
  import SearchPicker from "$lib/components/SearchPicker.svelte";
  import { formatDateTime } from "$lib/format";
  import { COMM_CHANNEL_LABELS, DIRECTION_LABELS } from "$lib/labels";
  import type { ActionData, PageData } from "./$types";

  type Message = components["schemas"]["Communication"];

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const caseOptions = $derived(
    data.cases.map((c) => ({ id: c.id, label: `${c.number} – ${c.title}`, hint: c.customerName })),
  );
  let leadFor = $state<string | null>(null);
  let pick = $state<Record<string, string>>({});

  /** "Max Muster" → Vor- und Nachname als Vorbelegung. */
  function splitName(name: string | null | undefined) {
    const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { lastName: parts[0] ?? "" };
    return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
  }

  const counterpart = (m: Message) =>
    m.participants
      .filter((p) => (m.direction === "eingehend" ? p.role === "from" : p.role !== "from"))
      .map((p) => (p.name ? `${p.name} <${p.address}>` : p.address))
      .join(", ");
</script>

<svelte:head><title>Inbox – objektakte</title></svelte:head>

<div class="spread">
  <h1>Zuordnungs-Inbox</h1>
  <form method="post" action="?/rematch" use:enhance>
    <button type="submit">Erneut zuordnen</button>
  </form>
</div>

<FormError {form} />
{#if form && "done" in form}
  <p class="success" role="status">
    {form.done}
    {#if "caseId" in form && form.caseId}<a href="/vorgaenge/{form.caseId}">Zum Vorgang</a>{/if}
  </p>
{/if}

{#snippet message(m: Message, automatic: boolean)}
  <article class="card msg" data-testid="inbox-message">
    <div class="spread">
      <div>
        <span class="badge">{COMM_CHANNEL_LABELS[m.channel] ?? m.channel}</span>
        <span class="small muted">{DIRECTION_LABELS[m.direction] ?? m.direction}</span>
        <strong>{m.subject ?? "(ohne Betreff)"}</strong>
      </div>
      <time class="small muted" datetime={m.occurredAt}>{formatDateTime(m.occurredAt)}</time>
    </div>
    <p class="small">
      {counterpart(m) || "–"}
      {#if m.contactName}· Kontakt: <a href="/kontakte/{m.contactId}">{m.contactName}</a>{/if}
    </p>
    {#if m.body}<details><summary class="small">Text</summary><pre class="body">{m.body}</pre></details>{/if}
    {#if m.matchReason}
      <p class="small muted">
        {m.matchReason}{#if m.matchConfidence != null} ({Math.round(m.matchConfidence * 100)} %){/if}
      </p>
    {/if}

    {#if automatic && m.caseId}
      <div class="row">
        <span>Zugeordnet zu <a href="/vorgaenge/{m.caseId}">{m.caseNumber}</a></span>
        <form method="post" action="?/confirm" use:enhance>
          <input type="hidden" name="messageId" value={m.id} />
          <button type="submit" class="primary small">Bestätigen</button>
        </form>
      </div>
    {/if}

    {#if m.matchCandidates.length > 0}
      <div class="row small">
        Kandidaten:
        {#each m.matchCandidates as cand (cand.caseId)}
          <button type="button" class="small" onclick={() => (pick[m.id] = cand.caseId)}>
            {cand.number} ({Math.round(cand.score * 100)} %)
          </button>
        {/each}
      </div>
    {/if}

    <form method="post" action="?/assign" class="assign" use:enhance>
      <input type="hidden" name="messageId" value={m.id} />
      <SearchPicker
        name="caseId"
        label={automatic ? "Anderem Vorgang zuordnen" : "Vorgang zuordnen"}
        options={caseOptions}
        bind:value={() => pick[m.id] ?? "", (v) => (pick[m.id] = v)}
      />
      <div class="row">
        <label class="inline"><input type="checkbox" name="learnChannel" /> Kanal lernen</label>
        <button type="submit" class="primary small">Zuordnen</button>
      </div>
    </form>

    <div class="row actions">
      <form method="post" action="?/ignore" use:enhance>
        <input type="hidden" name="messageId" value={m.id} />
        <button type="submit" class="small">Ignorieren</button>
      </form>
      <button type="button" class="small" onclick={() => (leadFor = leadFor === m.id ? null : m.id)}>
        {leadFor === m.id ? "Abbrechen" : "Neue Anfrage anlegen"}
      </button>
    </div>

    {#if leadFor === m.id}
      <form
        method="post"
        action="?/lead"
        class="stack lead"
        use:enhance={() =>
          async ({ result, update }) => {
            await update();
            if (result.type === "success") leadFor = null;
          }}
      >
        <input type="hidden" name="messageId" value={m.id} />
        <h3>Neue Anfrage</h3>
        {#if m.contactId}
          <fieldset class="row">
            <legend>Kontakt</legend>
            <label class="inline"
              ><input type="radio" name="contactMode" value="existing" checked /> vorhandener Kontakt ({m.contactName})</label
            >
            <label class="inline"><input type="radio" name="contactMode" value="new" /> neuer Kontakt</label>
          </fieldset>
        {/if}
        <details open={!m.contactId}>
          <summary>Neuer Kontakt (Absenderadresse wird als Kanal übernommen)</summary>
          <ContactForm
            prefix="contact_"
            showChannels={false}
            contact={splitName(m.participants.find((p) => p.role === "from")?.name)}
          />
        </details>
        <div class="form-grid">
          <label class="full">Titel der Anfrage <input name="title" value={m.subject ?? ""} required /></label>
          <label
            >Leistungsart
            <select name="measureCode">
              <option value="">– keine –</option>
              {#each data.measureTypes.filter((x) => x.active) as mt (mt.code)}
                <option value={mt.code}>{mt.code} – {mt.name}</option>
              {/each}
            </select>
          </label>
          <label class="full">Notiz <textarea name="notes" rows="2"></textarea></label>
        </div>
        <div><button type="submit" class="primary">Anfrage anlegen</button></div>
      </form>
    {/if}
  </article>
{/snippet}

<section>
  <h2>Offen <span class="badge">{data.inbox.open.length}</span></h2>
  {#each data.inbox.open as m (m.id)}
    {@render message(m, false)}
  {:else}
    <p class="muted">Keine offenen Nachrichten.</p>
  {/each}
</section>

<section>
  <h2>Automatisch zugeordnet, unbestätigt <span class="badge">{data.inbox.automatic.length}</span></h2>
  {#each data.inbox.automatic as m (m.id)}
    {@render message(m, true)}
  {:else}
    <p class="muted">Keine.</p>
  {/each}
</section>

<style>
  .msg {
    margin-bottom: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .msg p {
    margin: 0;
  }
  .assign {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }
  .lead {
    background: var(--surface-2);
    border-radius: var(--radius);
    padding: 0.75rem;
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
  }
</style>
