<script lang="ts">
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Anmelden – objektakte</title></svelte:head>

<main class="login">
  <form method="post" class="card stack">
    <h1>objektakte</h1>
    <p class="muted">Fallakte Energieberatung</p>
    <label>
      Passwort
      <!-- svelte-ignore a11y_autofocus -->
      <input type="password" name="password" autocomplete="current-password" required autofocus />
    </label>
    {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
    <button type="submit" class="primary">Anmelden</button>
  </form>
</main>

<style>
  .login {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1rem;
  }
  form {
    width: min(100%, 22rem);
  }
  h1 {
    margin: 0;
  }
  p {
    margin: 0;
  }
</style>
