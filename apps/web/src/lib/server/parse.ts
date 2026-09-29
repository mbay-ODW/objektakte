/** Formulardaten in API-Eingaben umwandeln. */
import type { components } from "$lib/api/schema";
import { cents, int, lines, num, text } from "./forms";

type Schemas = components["schemas"];
type ChannelInput = Schemas["ContactCreate"]["channels"] extends (infer T)[] | undefined
  ? T
  : never;

/** Kanäle aus parallelen Feldern `channel_kind`, `channel_value`, `channel_label`. */
export function parseChannels(fd: FormData): ChannelInput[] {
  const kinds = fd.getAll("channel_kind").map(String);
  const values = fd.getAll("channel_value").map(String);
  const labels = fd.getAll("channel_label").map(String);
  const primary = fd.get("channel_primary");
  const out: ChannelInput[] = [];
  kinds.forEach((kind, i) => {
    const value = values[i]?.trim();
    if (!value) return;
    out.push({
      kind: kind as ChannelInput["kind"],
      value,
      label: labels[i]?.trim() || null,
      isPrimary: primary === String(i),
    });
  });
  return out;
}

export function parseContact(fd: FormData, prefix = "") {
  const t = (name: string) => text(fd, `${prefix}${name}`);
  const kind = fd.get(`${prefix}kind`) === "organisation" ? "organisation" : "person";
  return {
    kind,
    displayName: t("displayName"),
    salutation: t("salutation"),
    firstName: t("firstName"),
    lastName: t("lastName"),
    organisationName: t("organisationName"),
    customerNumber: t("customerNumber"),
    street: t("street"),
    postalCode: t("postalCode"),
    city: t("city"),
    country: t("country")?.toUpperCase() ?? "DE",
    leitwegId: t("leitwegId"),
    vatId: t("vatId"),
    notes: t("notes"),
    channels: prefix ? [] : parseChannels(fd),
  } satisfies Schemas["ContactCreate"];
}

export function parseObject(fd: FormData) {
  const usage = text(fd, "usage") ?? "unbekannt";
  return {
    label: text(fd, "label") ?? "",
    street: text(fd, "street"),
    postalCode: text(fd, "postalCode"),
    city: text(fd, "city"),
    country: text(fd, "country")?.toUpperCase() ?? "DE",
    usage: usage as Schemas["ObjectCreate"]["usage"] & string,
    buildingType: text(fd, "buildingType"),
    constructionYear: int(fd, "constructionYear"),
    heatedAreaM2: num(fd, "heatedAreaM2"),
    units: int(fd, "units"),
    storagePath: text(fd, "storagePath"),
    notes: text(fd, "notes"),
  };
}

export function parseCase(fd: FormData) {
  return {
    title: text(fd, "title") ?? "",
    customerId: text(fd, "customerId") ?? "",
    objectId: text(fd, "objectId"),
    measureCode: text(fd, "measureCode"),
    status: (text(fd, "status") ?? undefined) as Schemas["CaseCreate"]["status"],
    openedAt: text(fd, "openedAt"),
    storagePath: text(fd, "storagePath"),
    notes: text(fd, "notes"),
  };
}

const FUNDING_DATES = [
  "tpbCreatedAt",
  "bzaCreatedAt",
  "appliedAt",
  "approvedAt",
  "approvalValidUntil",
  "measureCompletedAt",
  "tpnCreatedAt",
  "proofSubmittedAt",
  "paidOutAt",
  "isfpDate",
] as const;

export function parseFunding(fd: FormData) {
  const dates = Object.fromEntries(FUNDING_DATES.map((k) => [k, text(fd, k)])) as Record<
    (typeof FUNDING_DATES)[number],
    string | null
  >;
  return {
    programCode: text(fd, "programCode") ?? "",
    guideline: text(fd, "guideline"),
    applicationId: text(fd, "applicationId"),
    tpbId: text(fd, "tpbId"),
    tpnId: text(fd, "tpnId"),
    ...dates,
    eligibleCostsCents: cents(fd, "eligibleCosts"),
    approvedAmountCents: cents(fd, "approvedAmount"),
    ratePercent: num(fd, "ratePercent"),
    bonuses: lines(fd, "bonuses"),
    notes: text(fd, "notes"),
  };
}
