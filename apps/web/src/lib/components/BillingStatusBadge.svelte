<script lang="ts">
  import { BILLING_STATUS_LABELS, type BillingStatus } from "$lib/labels";

  let { status }: { status: BillingStatus } = $props();
  const tone: Record<BillingStatus, string> = {
    entwurf: "warn",
    festgeschrieben: "info",
    versendet: "ok",
    storniert: "",
  };
</script>

<span class="badge {tone[status]}">{BILLING_STATUS_LABELS[status]}</span>
