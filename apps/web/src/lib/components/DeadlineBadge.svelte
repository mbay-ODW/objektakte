<script lang="ts">
  import { dueLabel, todayIso } from "$lib/format";

  let {
    status,
    dueDate,
    remindFrom = null,
    today = todayIso(),
  }: { status: string; dueDate: string; remindFrom?: string | null; today?: string } = $props();

  const tone = $derived(
    status === "erledigt"
      ? "ok"
      : status === "verworfen"
        ? ""
        : dueDate < today
          ? "danger"
          : remindFrom && remindFrom <= today
            ? "warn"
            : "info",
  );
  const label = $derived(
    status === "offen" ? dueLabel(dueDate, today) : status === "erledigt" ? "erledigt" : "verworfen",
  );
</script>

<span class="badge {tone}">{label}</span>
