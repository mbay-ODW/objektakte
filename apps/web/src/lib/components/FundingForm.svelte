<script lang="ts">
  import type { components } from "$lib/api/schema";
  import { centsInput } from "$lib/format";
  import { FUNDING_DATE_FIELDS } from "$lib/labels";

  let {
    funding = null,
    programs,
  }: {
    funding?: components["schemas"]["FundingCase"] | null;
    programs: components["schemas"]["FundingProgram"][];
  } = $props();
</script>

<div class="form-grid">
  <label
    >Förderprogramm
    <select name="programCode" value={funding?.programCode ?? ""} required>
      <option value="" disabled>– wählen –</option>
      {#each programs.filter((p) => p.active || p.code === funding?.programCode) as p (p.code)}
        <option value={p.code}>{p.name}</option>
      {/each}
    </select>
  </label>
  <label
    >Richtlinienstand <input
      name="guideline"
      value={funding?.guideline ?? ""}
      placeholder="z. B. 2024-01"
    /></label
  >
  <label>Antrags-ID <input name="applicationId" value={funding?.applicationId ?? ""} /></label>
  <label>TPB-ID <input name="tpbId" value={funding?.tpbId ?? ""} /></label>
  <label>TPN-ID <input name="tpnId" value={funding?.tpnId ?? ""} /></label>
  {#each FUNDING_DATE_FIELDS as [field, label] (field)}
    <label>{label} <input type="date" name={field} value={funding?.[field] ?? ""} /></label>
  {/each}
  <label
    >Förderfähige Kosten (€) <input
      name="eligibleCosts"
      inputmode="decimal"
      value={centsInput(funding?.eligibleCostsCents)}
    /></label
  >
  <label
    >Bewilligter Betrag (€) <input
      name="approvedAmount"
      inputmode="decimal"
      value={centsInput(funding?.approvedAmountCents)}
    /></label
  >
  <label
    >Fördersatz (%) <input
      name="ratePercent"
      inputmode="decimal"
      value={funding?.ratePercent != null ? String(funding.ratePercent).replace(".", ",") : ""}
    /></label
  >
  <label class="full"
    >Boni (je Zeile) <textarea name="bonuses" rows="2">{funding?.bonuses.join("\n") ?? ""}</textarea
    ></label
  >
  <label class="full">Notizen <textarea name="notes" rows="2">{funding?.notes ?? ""}</textarea></label>
</div>
