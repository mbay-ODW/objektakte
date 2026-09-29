/**
 * Interne Vorprüfung vor dem Festschreiben. Deckt die häufigsten Pflichtangaben aus EN 16931
 * und XRechnung ab und liefert verständliche deutsche Meldungen. Ersetzt nicht die Prüfung durch
 * einen vollständigen Validator (Schematron), die zusätzlich erfolgt.
 */

import type { CiiProfile } from "./cii.js";
import { type CanonicalInvoice, computeTotals, UNIT_CODES } from "./model.js";

export interface RuleViolation {
  rule: string;
  message: string;
}

export function checkInvoice(inv: CanonicalInvoice, profile: CiiProfile): RuleViolation[] {
  const v: RuleViolation[] = [];
  const need = (cond: unknown, rule: string, message: string) => {
    if (!cond) v.push({ rule, message });
  };
  const s = inv.seller;
  const b = inv.buyer;
  const categories = new Set(inv.lines.map((l) => l.taxCategory));

  need(inv.lines.length > 0, "BR-16", "Mindestens eine Position erforderlich");
  inv.lines.forEach((l) => {
    need(l.name.trim(), "BR-25", `Position ${l.position}: Bezeichnung fehlt`);
    need(l.quantity !== 0, "BR-22", `Position ${l.position}: Menge darf nicht 0 sein`);
    need(
      UNIT_CODES[l.unitCode],
      "BR-23",
      `Position ${l.position}: unbekannte Einheit ${l.unitCode}`,
    );
    if (l.taxCategory === "S")
      need(l.taxRatePercent > 0, "BR-S-05", `Position ${l.position}: Steuersatz fehlt`);
    else need(l.taxRatePercent === 0, "BR-E-05", `Position ${l.position}: Steuersatz muss 0 sein`);
  });

  need(s.name, "BR-6", "Name des Verkäufers fehlt (Firmendaten)");
  need(s.country, "BR-9", "Land des Verkäufers fehlt");
  need(b.name, "BR-7", "Name des Käufers fehlt");
  need(b.country, "BR-11", "Land des Käufers fehlt");
  need(s.vatId || s.id, "BR-CO-26", "USt-IdNr. oder Verkäuferkennung erforderlich (Firmendaten)");
  if (categories.has("S")) {
    need(
      s.vatId || s.taxNumber,
      "BR-S-02",
      "USt-IdNr. oder Steuernummer des Verkäufers erforderlich",
    );
  }
  if (categories.has("E"))
    need(inv.exemptionReasons.E, "BR-E-10", "Grund der Steuerbefreiung fehlt");
  if (categories.has("AE")) {
    need(
      inv.exemptionReasons.AE,
      "BR-AE-10",
      "Hinweis auf Steuerschuldnerschaft des Leistungsempfängers fehlt",
    );
    need(s.vatId, "BR-AE-02", "Reverse Charge: USt-IdNr. des Verkäufers erforderlich");
    need(b.vatId, "BR-AE-02", "Reverse Charge: USt-IdNr. des Käufers erforderlich");
  }
  const totals = computeTotals(inv);
  if (totals.duePayableCents > 0) {
    need(
      inv.dueDate || inv.payment.termsText,
      "BR-CO-25",
      "Fälligkeitsdatum oder Zahlungsbedingungen erforderlich",
    );
  }
  if (inv.kind === "stornorechnung") {
    need(inv.precedingInvoice, "BR-55", "Storno ohne Bezug auf die ursprüngliche Rechnung");
  }

  if (profile === "xrechnung") {
    need(inv.buyerReference, "BR-DE-15", "Leitweg-ID bzw. Käuferreferenz erforderlich");
    need(s.contactName, "BR-DE-5", "Ansprechpartner des Verkäufers fehlt (Firmendaten)");
    need(s.phone, "BR-DE-6", "Telefonnummer des Verkäufers fehlt (Firmendaten)");
    need(s.email, "BR-DE-7", "E-Mail des Verkäufers fehlt (Firmendaten)");
    need(s.city && s.postalCode, "BR-DE-3/4", "Ort und PLZ des Verkäufers erforderlich");
    need(b.city && b.postalCode, "BR-DE-8/9", "Ort und PLZ des Käufers erforderlich");
    need(b.email, "PEPPOL-EN16931-R010", "Elektronische Adresse (E-Mail) des Käufers erforderlich");
    need(inv.payment.iban, "BR-DE-1", "Bankverbindung (IBAN) erforderlich");
  }
  return v;
}
