<script lang="ts">
  import { enhance } from "$app/forms";
  import FormError from "$lib/components/FormError.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Webhooks – objektakte</title></svelte:head>

<FormError {form} />
{#if form && "created" in form && form.created}
  <div class="success stack" role="status">
    <strong>Webhook angelegt.</strong>
    <span>Signatur-Geheimnis (wird nur jetzt angezeigt):</span>
    <code class="secret" data-testid="webhook-secret">{form.created.secret}</code>
  </div>
{/if}

<section class="card">
  <h2>Webhooks</h2>
  <p class="small muted">Zustellung signiert per HMAC-SHA256; siehe Dokumentation „Ereignisse und Webhooks“.</p>
  <ul class="plain">
    {#each data.items as w (w.id)}
      <li class="spread">
        <div>
          <span class="mono">{w.url}</span>
          {#if w.active}<span class="badge ok">aktiv</span>{:else}<span class="badge">pausiert</span>{/if}
          <div class="small muted">
            Ereignisse: {w.eventTypes.join(", ")} · letzte Ereignis-ID {w.lastEventId}
            {#if w.failures > 0}· <span class="badge danger">{w.failures} Fehler</span>{/if}
          </div>
          {#if w.lastError}<div class="small error">{w.lastError}</div>{/if}
        </div>
        <div class="row">
          <form method="post" action="?/toggle" use:enhance>
            <input type="hidden" name="id" value={w.id} />
            <input type="hidden" name="active" value={String(!w.active)} />
            <button type="submit" class="small">{w.active ? "Pausieren" : "Fortsetzen"}</button>
          </form>
          <form
            method="post"
            action="?/remove"
            use:enhance={({ cancel }) => {
              if (!confirm("Webhook wirklich löschen?")) cancel();
            }}
          >
            <input type="hidden" name="id" value={w.id} />
            <button type="submit" class="small danger">Löschen</button>
          </form>
        </div>
      </li>
    {:else}
      <li class="muted">Keine Webhooks.</li>
    {/each}
  </ul>
</section>

<section class="card">
  <h2>Neuer Webhook</h2>
  <form method="post" action="?/create" class="form-grid" use:enhance>
    <label class="full">URL <input name="url" type="url" required placeholder="https://automation.example.org/hook" /></label>
    <label class="full"
      >Ereignistypen (je Zeile, leer = alle)
      <textarea name="eventTypes" rows="2" placeholder="case.*&#10;deadline.created"></textarea>
    </label>
    <label class="inline"><input type="checkbox" name="replay" /> bisherige Ereignisse nachliefern</label>
    <div><button type="submit" class="primary">Anlegen</button></div>
  </form>
</section>

<style>
  .secret {
    word-break: break-all;
    font-family: var(--mono);
  }
</style>
