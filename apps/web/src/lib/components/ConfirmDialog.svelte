<script lang="ts">
  import type { Snippet } from "svelte";
  import { enhance } from "$app/forms";

  /** Bestätigungsdialog (natives <dialog>) mit Formular für eine Form-Action. */
  let {
    trigger,
    title,
    action,
    confirmLabel,
    danger = false,
    disabled = false,
    acknowledge = null,
    triggerClass = "",
    children,
    fields,
  }: {
    trigger: string;
    title: string;
    action: string;
    confirmLabel: string;
    danger?: boolean;
    disabled?: boolean;
    /** Text einer Pflicht-Checkbox, die vor dem Bestätigen angehakt werden muss. */
    acknowledge?: string | null;
    triggerClass?: string;
    children: Snippet;
    fields?: Snippet;
  } = $props();

  const uid = $props.id();
  let dialog = $state<HTMLDialogElement | null>(null);
  let busy = $state(false);
</script>

<button type="button" class={triggerClass} {disabled} onclick={() => dialog?.showModal()}>{trigger}</button>

<dialog bind:this={dialog} aria-labelledby="dlg-{uid}">
  <form
    method="post"
    {action}
    class="stack"
    use:enhance={() => {
      busy = true;
      return async ({ update }) => {
        busy = false;
        dialog?.close();
        await update();
      };
    }}
  >
    <h2 id="dlg-{uid}">{title}</h2>
    {@render children()}
    {@render fields?.()}
    {#if acknowledge}
      <label class="inline"><input type="checkbox" required /> {acknowledge}</label>
    {/if}
    <div class="row">
      <button type="submit" class={danger ? "danger" : "primary"} disabled={busy}>
        {busy ? "Bitte warten …" : confirmLabel}
      </button>
      <button type="button" onclick={() => dialog?.close()}>Abbrechen</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    max-width: min(34rem, calc(100vw - 2rem));
    padding: 1.25rem;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
</style>
