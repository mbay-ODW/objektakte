<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { formatDateTime } from "$lib/format";
  import { CATEGORY_LABELS } from "$lib/labels";
  import type { ItemInput } from "$lib/offline/service";
  import type { CachedObject, LocalInspection, LocalItem, Participant } from "$lib/offline/types";
  import { VorOrtState } from "$lib/offline/vor-ort.svelte";
  import ItemEditor from "$lib/vor-ort/ItemEditor.svelte";
  import MediaCapture from "$lib/vor-ort/MediaCapture.svelte";
  import MediaList from "$lib/vor-ort/MediaList.svelte";
  import SyncBar from "$lib/vor-ort/SyncBar.svelte";

  const app = new VorOrtState();

  onMount(() => {
    void app.init().then(() => {
      if (currentId) void app.refreshInspection(currentId);
    });
  });
  onDestroy(() => app.destroy());

  const currentId = $derived(page.url.searchParams.get("b"));
  const current = $derived(app.inspections.find((i) => i.id === currentId) ?? null);
  const preselectObject = $derived(page.url.searchParams.get("objekt"));
  const preselectCase = $derived(page.url.searchParams.get("vorgang"));

  // --- Start einer Begehung -------------------------------------------------
  let objectQuery = $state("");
  let chosenObjectId = $state<string | null>(null);
  $effect(() => {
    if (preselectObject && !chosenObjectId) chosenObjectId = preselectObject;
  });
  const chosenObject = $derived(app.objects.find((o) => o.id === chosenObjectId) ?? null);
  const filteredObjects = $derived.by(() => {
    const q = objectQuery.trim().toLowerCase();
    const list = q
      ? app.objects.filter((o) =>
          [o.label, o.street, o.postalCode, o.city].join(" ").toLowerCase().includes(q),
        )
      : app.objects;
    return list.slice(0, 50);
  });

  let startTitle = $state("Begehung vor Ort");
  let startCase = $state("");
  let startParticipants = $state("");
  let startWeather = $state("");
  let startNotes = $state("");
  let error = $state<string | null>(null);

  $effect(() => {
    if (preselectCase && !startCase) startCase = preselectCase;
  });

  function parseParticipants(text: string): Participant[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, ...role] = line.split(",");
        return { name: (name ?? "").trim(), role: role.join(",").trim() || null };
      })
      .filter((p) => p.name);
  }
  const participantsText = (list: Participant[]) =>
    list.map((p) => (p.role ? `${p.name}, ${p.role}` : p.name)).join("\n");

  async function startInspection(e: SubmitEvent, obj: CachedObject) {
    e.preventDefault();
    if (!app.service) return;
    error = null;
    try {
      const created = await app.service.start({
        objectId: obj.id,
        objectLabel: obj.label,
        caseId: startCase || null,
        title: startTitle.trim() || "Begehung vor Ort",
        participants: parseParticipants(startParticipants),
        weather: startWeather.trim() || null,
        notes: startNotes.trim() || null,
      });
      chosenObjectId = null;
      startParticipants = startWeather = startNotes = "";
      await goto(`/vor-ort?b=${created.id}`);
      void app.sync(false);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // --- Bearbeiten einer laufenden Begehung ---------------------------------
  let editing = $state<string | "new" | null>(null);
  let editGeneral = $state(false);
  let genTitle = $state("");
  let genParticipants = $state("");
  let genWeather = $state("");
  let genNotes = $state("");

  function openGeneral(i: LocalInspection) {
    genTitle = i.title;
    genParticipants = participantsText(i.participants);
    genWeather = i.weather ?? "";
    genNotes = i.notes ?? "";
    editGeneral = true;
  }

  async function run(fn: () => Promise<unknown>) {
    error = null;
    try {
      await fn();
      void app.sync(false);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function saveGeneral(e: SubmitEvent, i: LocalInspection) {
    e.preventDefault();
    await run(async () => {
      await app.service?.update(i.id, {
        title: genTitle.trim() || i.title,
        participants: parseParticipants(genParticipants),
        weather: genWeather.trim() || null,
        notes: genNotes.trim() || null,
      });
      editGeneral = false;
    });
  }

  async function saveItem(i: LocalInspection, input: ItemInput) {
    await run(async () => {
      await app.service?.saveItem(i.id, input);
      editing = null;
    });
  }

  async function deleteItem(i: LocalInspection, item: LocalItem) {
    if (!confirm(`Position „${item.label}“ löschen?`)) return;
    await run(async () => {
      await app.service?.deleteItem(i.id, item.id);
      editing = null;
    });
  }

  const addMedia =
    (i: LocalInspection, kind: "foto" | "audio", itemId: string | null) => (blob: Blob) =>
      run(() => app.service?.addMedia(i.id, blob, { kind, itemId, caption: null }) ?? Promise.resolve());

  let finalizing = $state(false);
  async function finalize(i: LocalInspection) {
    if (!confirm("Begehung abschließen? Danach sind keine Änderungen mehr möglich.")) return;
    finalizing = true;
    error = null;
    try {
      await app.service?.finalize(i.id);
      if (app.queue.lastError) error = app.queue.lastError;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      finalizing = false;
    }
  }

  const pendingCurrent = $derived(current ? app.pendingFor(current.id) : 0);
  const finalizeJobPending = $derived(
    current ? app.jobs.some((j) => j.payload.type === "finalize" && j.payload.inspectionId === current.id) : false,
  );
</script>

<svelte:head>
  <title>Vor Ort – objektakte</title>
  <meta name="theme-color" content="#1f6f5c" />
</svelte:head>

<SyncBar {app} />

<main class="vor-ort">
  <header class="spread">
    <a href={currentId ? "/vor-ort" : "/"} class="back">{currentId ? "← Begehungen" : "← Büro"}</a>
    <strong>Vor Ort</strong>
  </header>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if !app.ready}
    <p class="muted">Lade …</p>
  {:else if currentId && !current}
    <p class="muted">Begehung nicht gefunden (noch nicht geladen?).</p>
    <button type="button" onclick={() => currentId && app.refreshInspection(currentId)}>Vom Server laden</button>
  {:else if current}
    {@const i = current}
    {@const done = i.status === "abgeschlossen"}
    <section class="card stack">
      <div class="spread">
        <h1>{i.title}</h1>
        <span class="badge {done ? 'ok' : 'warn'}">{done ? "abgeschlossen" : "laufend"}</span>
      </div>
      <p class="muted small">{i.objectLabel} · Beginn {formatDateTime(i.startedAt)}</p>
      {#if !editGeneral}
        <dl class="facts small">
          {#if i.participants.length}<dt>Teilnehmende</dt><dd>{i.participants.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(", ")}</dd>{/if}
          {#if i.weather}<dt>Witterung</dt><dd>{i.weather}</dd>{/if}
          {#if i.notes}<dt>Notizen</dt><dd><pre class="body">{i.notes}</pre></dd>{/if}
        </dl>
        {#if !done}<div><button type="button" class="small" onclick={() => openGeneral(i)}>Allgemeine Angaben bearbeiten</button></div>{/if}
      {:else}
        <form class="stack" onsubmit={(e) => saveGeneral(e, i)}>
          <label>Anlass <input bind:value={genTitle} required /></label>
          <label>Teilnehmende (je Zeile „Name, Rolle“) <textarea bind:value={genParticipants} rows="3"></textarea></label>
          <label>Witterung <input bind:value={genWeather} /></label>
          <label>Notizen <textarea bind:value={genNotes} rows="3"></textarea></label>
          <div class="row">
            <button type="submit" class="primary">Speichern</button>
            <button type="button" onclick={() => (editGeneral = false)}>Abbrechen</button>
          </div>
        </form>
      {/if}
    </section>

    <section class="card stack">
      <h2>Allgemeine Aufnahmen</h2>
      {#if !done}
        <MediaCapture label="allgemein" onphoto={addMedia(i, "foto", null)} onaudio={addMedia(i, "audio", null)} />
      {/if}
      <MediaList {app} media={i.media.filter((m) => !m.itemId)} />
    </section>

    <section class="stack">
      <div class="spread">
        <h2>Positionen <span class="badge">{i.items.length}</span></h2>
        {#if !done && editing !== "new"}
          <button type="button" class="primary" onclick={() => (editing = "new")}>+ Position</button>
        {/if}
      </div>
      {#if editing === "new"}
        <ItemEditor onsave={(input) => saveItem(i, input)} oncancel={() => (editing = null)} />
      {/if}
      {#each i.items as item (item.id)}
        <article class="card item" data-testid="inspection-item">
          {#if editing === item.id}
            <ItemEditor
              {item}
              onsave={(input) => saveItem(i, input)}
              oncancel={() => (editing = null)}
              ondelete={() => deleteItem(i, item)}
            />
          {:else}
            <div class="spread">
              <div>
                <span class="badge info">{CATEGORY_LABELS[item.category]}</span>
                <strong>{item.label}</strong>
                {#if item.location}<span class="muted small">· {item.location}</span>{/if}
              </div>
              {#if item.condition}
                <span class="badge {item.condition === 'gut' ? 'ok' : item.condition === 'mittel' ? 'warn' : 'danger'}">{item.condition}</span>
              {/if}
            </div>
            {#if Object.keys(item.attributes).length}
              <dl class="facts small">
                {#each Object.entries(item.attributes) as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
              </dl>
            {/if}
            {#if item.notes}<pre class="body small">{item.notes}</pre>{/if}
            <MediaList {app} media={i.media.filter((m) => m.itemId === item.id)} />
            {#if !done}
              <div class="row">
                <button type="button" class="small" onclick={() => (editing = item.id)}>Bearbeiten</button>
              </div>
              <MediaCapture label={item.label} onphoto={addMedia(i, "foto", item.id)} onaudio={addMedia(i, "audio", item.id)} />
            {/if}
          {/if}
        </article>
      {:else}
        {#if editing !== "new"}<p class="muted">Noch keine Positionen erfasst.</p>{/if}
      {/each}
    </section>

    <section class="card stack finalize">
      <h2>Abschluss</h2>
      {#if done}
        <p class="success">Begehung abgeschlossen{#if i.finalizedAt} am {formatDateTime(i.finalizedAt)}{/if}.</p>
        {#if i.protocolDocumentId}
          <a class="button primary" data-testid="protocol-link" href="/dokumente/{i.protocolDocumentId}" target="_blank" rel="noopener">Begehungsprotokoll öffnen</a>
        {:else}
          <p class="small muted">Protokoll wird erzeugt …</p>
        {/if}
      {:else if finalizeJobPending}
        <p class="small">Abschluss wird übertragen, sobald eine Verbindung besteht.</p>
      {:else if pendingCurrent > 0}
        <p class="small">
          Noch {pendingCurrent} Änderung(en) nicht übertragen. Der Abschluss ist erst nach der
          Synchronisation möglich.
        </p>
        <div>
          <button type="button" onclick={() => app.sync(true)} disabled={!app.online}>Jetzt synchronisieren</button>
        </div>
      {:else}
        <p class="small">Alle Angaben sind übertragen. Nach dem Abschluss wird die Begehung festgeschrieben und das Protokoll erzeugt.</p>
        <div>
          <button type="button" class="primary" onclick={() => finalize(i)} disabled={!app.online || finalizing}>
            {finalizing ? "Schließe ab …" : "Begehung abschließen"}
          </button>
        </div>
      {/if}
      {#if app.online}
        <div><button type="button" class="small" onclick={() => app.refreshInspection(i.id)}>Serverstand aktualisieren</button></div>
      {/if}
    </section>
  {:else}
    <section class="card stack">
      <h1>Neue Begehung</h1>
      {#if chosenObject}
        {@const obj = chosenObject}
        <div class="spread">
          <div>
            <strong>{obj.label}</strong>
            <div class="small muted">{[obj.street, [obj.postalCode, obj.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</div>
          </div>
          <button type="button" class="small" onclick={() => (chosenObjectId = null)}>Anderes Objekt</button>
        </div>
        <form class="stack" onsubmit={(e) => startInspection(e, obj)}>
          <label>Anlass <input name="title" bind:value={startTitle} required /></label>
          {#if obj.cases.length}
            <label
              >Vorgang
              <select name="caseId" bind:value={startCase}>
                <option value="">– ohne Vorgang –</option>
                {#each obj.cases as c (c.id)}<option value={c.id}>{c.number} – {c.title}</option>{/each}
              </select>
            </label>
          {/if}
          <label>Teilnehmende (je Zeile „Name, Rolle“) <textarea name="participants" bind:value={startParticipants} rows="3"></textarea></label>
          <label>Witterung <input name="weather" bind:value={startWeather} placeholder="z. B. bewölkt, 12 °C" /></label>
          <label>Notizen <textarea name="notes" bind:value={startNotes} rows="3"></textarea></label>
          <button type="submit" class="primary">Begehung starten</button>
        </form>
      {:else}
        <label>Objekt suchen <input type="search" bind:value={objectQuery} placeholder="Bezeichnung, Straße, Ort" /></label>
        <p class="small muted">
          {app.objects.length} Objekte offline verfügbar{#if app.objectsCachedAt}, Stand {formatDateTime(app.objectsCachedAt)}{/if}.
          {#if app.online}<button type="button" class="link" onclick={() => app.refreshObjects()}>Aktualisieren</button>{/if}
        </p>
        <ul class="plain objects">
          {#each filteredObjects as o (o.id)}
            <li>
              <button type="button" class="object" onclick={() => (chosenObjectId = o.id)}>
                <strong>{o.label}</strong>
                <span class="small muted">{[o.street, o.city].filter(Boolean).join(", ")}</span>
              </button>
            </li>
          {:else}
            <li class="muted">Keine Objekte gefunden.</li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="card stack">
      <h2>Begehungen auf diesem Gerät</h2>
      {#if app.inspections.length === 0}
        <p class="muted">Noch keine.</p>
      {:else}
        <ul class="plain">
          {#each app.inspections as b (b.id)}
            {@const pending = app.pendingFor(b.id)}
            <li class="spread">
              <a href="/vor-ort?b={b.id}">
                <strong>{b.title}</strong>
                <span class="small muted">{b.objectLabel} · {formatDateTime(b.startedAt)}</span>
              </a>
              <span class="row">
                {#if pending > 0}<span class="badge warn">{pending} ausstehend</span>{/if}
                <span class="badge {b.status === 'abgeschlossen' ? 'ok' : ''}">{b.status}</span>
                {#if b.status === "abgeschlossen" && pending === 0}
                  <button type="button" class="small" onclick={() => app.service?.forget(b.id)}>Vom Gerät entfernen</button>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if app.queue.failed > 0}
      <section class="card stack">
        <h2>Fehlerhafte Übertragungen</h2>
        <ul class="plain small">
          {#each app.jobs.filter((j) => j.failed) as j (j.seq)}
            <li class="spread">
              <span>{j.payload.type}: {j.lastError}</span>
              <button type="button" class="small danger" onclick={() => j.seq !== undefined && app.service?.queue.discard(j.seq)}>Verwerfen</button>
            </li>
          {/each}
        </ul>
        <div><button type="button" onclick={() => app.service?.queue.retryFailed().then(() => app.sync(true))}>Erneut versuchen</button></div>
      </section>
    {/if}
  {/if}
</main>

<style>
  .vor-ort {
    max-width: 42rem;
    margin: 0 auto;
    padding: 0.75rem 0.75rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .vor-ort section {
    margin: 0;
  }
  header {
    padding: 0.25rem 0;
  }
  .back {
    text-decoration: none;
  }
  h1 {
    font-size: 1.3rem;
    margin: 0;
  }
  h2 {
    margin: 0;
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .objects button.object {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    white-space: normal;
    text-align: left;
    min-height: 3rem;
    background: var(--surface);
  }
  .objects li {
    border: none;
    padding: 0.2rem 0;
  }
  li a {
    display: flex;
    flex-direction: column;
    text-decoration: none;
  }
  :global(.vor-ort button),
  :global(.vor-ort .button) {
    min-height: 2.75rem;
  }
</style>
