/** Deutsche Bezeichnungen für Enum-Werte der API. */
import type { components } from "$lib/api/schema";

type Schemas = components["schemas"];
export type CaseStatus = Schemas["Case"]["status"];
export type InspectionCategory = Schemas["InspectionItem"]["category"];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  anfrage: "Anfrage",
  angebot: "Angebot",
  beauftragt: "Beauftragt",
  in_bearbeitung: "In Bearbeitung",
  abrechnung: "Abrechnung",
  abgeschlossen: "Abgeschlossen",
  storniert: "Storniert",
};
export const CASE_STATUSES = Object.keys(CASE_STATUS_LABELS) as CaseStatus[];

/** Entspricht CATEGORY_LABELS im Begehungsprotokoll der API. */
export const CATEGORY_LABELS: Record<InspectionCategory, string> = {
  gebaeude_allgemein: "Gebäude allgemein",
  aussenwand: "Außenwand",
  dach: "Dach",
  oberste_geschossdecke: "Oberste Geschossdecke",
  kellerdecke: "Kellerdecke",
  bodenplatte: "Bodenplatte",
  fenster: "Fenster",
  tueren: "Türen",
  heizung: "Heizung",
  warmwasser: "Warmwasser",
  lueftung: "Lüftung",
  kuehlung: "Kühlung",
  beleuchtung: "Beleuchtung",
  pv_solar: "PV / Solarthermie",
  elektro: "Elektro",
  zone: "Zone / Nutzung",
  sonstiges: "Sonstiges",
};
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as InspectionCategory[];

export const CONDITION_LABELS = { gut: "gut", mittel: "mittel", schlecht: "schlecht" } as const;
export type Condition = keyof typeof CONDITION_LABELS;

export const CHANNEL_KIND_LABELS: Record<string, string> = {
  email: "E-Mail",
  phone: "Telefon",
  mobile: "Mobil",
  whatsapp: "WhatsApp",
  signal: "Signal",
  fax: "Fax",
  website: "Website",
};
export const CHANNEL_KINDS = Object.keys(CHANNEL_KIND_LABELS);

export const OBJECT_ROLE_LABELS: Record<string, string> = {
  eigentuemer: "Eigentümer",
  verwaltung: "Verwaltung",
  nutzer: "Nutzer",
  ansprechpartner: "Ansprechpartner",
  handwerker: "Handwerker",
  planer: "Planer",
  sonstige: "Sonstige",
};
export const OBJECT_ROLES = Object.keys(OBJECT_ROLE_LABELS);

export const USAGE_LABELS: Record<string, string> = {
  wohngebaeude: "Wohngebäude",
  nichtwohngebaeude: "Nichtwohngebäude",
  gemischt: "Gemischt",
  unbekannt: "Unbekannt",
};

export const DEADLINE_STATUS_LABELS: Record<string, string> = {
  offen: "offen",
  erledigt: "erledigt",
  verworfen: "verworfen",
};

/** Datumsfelder eines Förderfalls (API-Feld → Bezeichnung). */
export const FUNDING_DATE_FIELDS = [
  ["tpbCreatedAt", "TPB erstellt"],
  ["bzaCreatedAt", "BzA erstellt"],
  ["appliedAt", "Antrag gestellt"],
  ["approvedAt", "Zusage"],
  ["approvalValidUntil", "Ende Bewilligungszeitraum"],
  ["measureCompletedAt", "Maßnahme abgeschlossen"],
  ["tpnCreatedAt", "TPN erstellt"],
  ["proofSubmittedAt", "Nachweis eingereicht"],
  ["paidOutAt", "Auszahlung"],
  ["isfpDate", "iSFP-Datum"],
] as const;

export type FundingDateField = (typeof FUNDING_DATE_FIELDS)[number][0];

/** Anker der Fristenregeln (Datenbankname → Bezeichnung). */
export const ANCHOR_LABELS: Record<string, string> = {
  tpb_created_at: "TPB erstellt",
  bza_created_at: "BzA erstellt",
  applied_at: "Antrag gestellt",
  approved_at: "Zusage",
  approval_valid_until: "Ende Bewilligungszeitraum",
  measure_completed_at: "Maßnahme abgeschlossen",
  tpn_created_at: "TPN erstellt",
  proof_submitted_at: "Nachweis eingereicht",
  isfp_date: "iSFP-Datum",
};
export const ANCHORS = Object.keys(ANCHOR_LABELS);

export const ASSIGNMENT_LABELS: Record<string, string> = {
  offen: "offen",
  automatisch: "automatisch zugeordnet",
  bestaetigt: "bestätigt",
  ignoriert: "ignoriert",
};

export const COMM_CHANNEL_LABELS: Record<string, string> = {
  email: "E-Mail",
  whatsapp: "WhatsApp",
  signal: "Signal",
  telefon: "Telefon",
  vor_ort: "Vor Ort",
  brief: "Brief",
  notiz: "Notiz",
};

export const DIRECTION_LABELS: Record<string, string> = {
  eingehend: "eingehend",
  ausgehend: "ausgehend",
  intern: "intern",
};
