<script lang="ts">
  import { CASE_STATUS_LABELS, type CaseStatus } from "$lib/labels";

  let { status }: { status: CaseStatus } = $props();

  const tone: Record<CaseStatus, string> = {
    anfrage: "info",
    angebot: "info",
    beauftragt: "warn",
    in_bearbeitung: "warn",
    abrechnung: "warn",
    abgeschlossen: "ok",
    storniert: "",
  };
</script>

<span class="badge {tone[status]}">{CASE_STATUS_LABELS[status]}</span>
