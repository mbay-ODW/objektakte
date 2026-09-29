<script lang="ts">
  import type { components } from "$lib/api/schema";
  import { USAGE_LABELS } from "$lib/labels";

  let { object = null }: { object?: Partial<components["schemas"]["BuildingObject"]> | null } =
    $props();
</script>

<div class="form-grid">
  <label class="full">Bezeichnung <input name="label" value={object?.label ?? ""} required /></label>
  <label class="full">Straße <input name="street" value={object?.street ?? ""} /></label>
  <label>PLZ <input name="postalCode" value={object?.postalCode ?? ""} /></label>
  <label>Ort <input name="city" value={object?.city ?? ""} /></label>
  <label>Land <input name="country" value={object?.country ?? "DE"} maxlength="2" /></label>
  <label
    >Nutzung
    <select name="usage" value={object?.usage ?? "unbekannt"}>
      {#each Object.entries(USAGE_LABELS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
    </select>
  </label>
  <label
    >Gebäudetyp <input
      name="buildingType"
      value={object?.buildingType ?? ""}
      placeholder="z. B. EFH, MFH, Schule"
    /></label
  >
  <label
    >Baujahr <input
      name="constructionYear"
      type="number"
      min="1000"
      max="2100"
      value={object?.constructionYear ?? ""}
    /></label
  >
  <label
    >Beheizte Fläche (m²) <input
      name="heatedAreaM2"
      inputmode="decimal"
      value={object?.heatedAreaM2 != null ? String(object.heatedAreaM2).replace(".", ",") : ""}
    /></label
  >
  <label>Einheiten <input name="units" type="number" min="1" value={object?.units ?? ""} /></label>
  <label class="full"
    >Ablageordner <input
      name="storagePath"
      value={object?.storagePath ?? ""}
      placeholder="/Objekte/…"
    /></label
  >
  <label class="full">Notizen <textarea name="notes">{object?.notes ?? ""}</textarea></label>
</div>
