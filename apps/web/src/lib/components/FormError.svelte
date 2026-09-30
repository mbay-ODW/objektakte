<script lang="ts">
  let { form }: { form: { error?: string } | null | undefined } = $props();
</script>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
