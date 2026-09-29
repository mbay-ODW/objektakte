# Förderfälle und Fristen

Ein **Förderfall** hängt an einem Vorgang und hält die Eckdaten eines Förderverfahrens: Programm, Richtlinienstand, Antrags-/TPB-/TPN-IDs und alle relevanten Datumsangaben (Antrag, Zusage, Ende Bewilligungszeitraum, Abschluss, Nachweis, Auszahlung, iSFP-Datum).

## Fristen entstehen aus Regeln

Fristen werden nicht von Hand gepflegt, sondern aus **Fristenregeln** berechnet. Eine Regel ist ein Datensatz:

| Feld | Bedeutung |
|---|---|
| `programCode` | Programm, für das die Regel gilt (`*` = alle) |
| `guideline` | optional: nur für einen bestimmten Richtlinienstand |
| `anchor` | Datumsfeld des Förderfalls, an dem die Frist ansetzt |
| `offsetMonths`, `offsetDays` | Versatz ab Anker (Monatsarithmetik nach § 188 BGB: fehlt der Tag, gilt der Monatsletzte) |
| `leadDays` | Vorlauf für Erinnerungen |
| `doneWhen` | Datumsfeld, dessen Setzen die Frist automatisch erledigt |
| `sourceNote` | Beleg (Richtlinie, Merkblatt) |

Das Ende des Bewilligungszeitraums wird, falls im Förderfall nicht explizit eingetragen, aus Zusagedatum + Standardzeitraum des Programms berechnet.

Bei jeder Änderung eines Förderfalls oder einer Regel werden die betroffenen Fristen neu berechnet:
- neue Anker → neue Fristen,
- geänderte Anker → Datum wird nachgeführt,
- `doneWhen` gesetzt → Frist „erledigt“; wird das Feld wieder geleert, öffnet sich die Frist erneut,
- Anker entfällt → offene Frist wird entfernt,
- manuell erledigte oder verworfene Fristen bleiben als Historie erhalten.

Zusätzlich lassen sich **manuelle Wiedervorlagen** (`POST /api/v1/deadlines`) anlegen.

## Mitgelieferte Regeln

Die Migration `0003_seed_foerderprogramme.sql` legt Programme und Regeln an. **Sie sind nach bestem Wissen aus den Richtlinien abgeleitet, ersetzen aber keine Prüfung der aktuellen Merkblätter.** Anpassung jederzeit über `/api/v1/deadline-rules`.

| Programm | Frist | Berechnung | Erledigt durch |
|---|---|---|---|
| BEG EM (BAFA) | Ende Bewilligungszeitraum | Zusage + 36 Monate | Abschluss der Maßnahme |
| BEG EM (BAFA) | Verwendungsnachweis | Ende Bewilligungszeitraum + 6 Monate | Nachweis eingereicht |
| BEG EM (BAFA) | TPN-ID läuft ab | TPN-Erstellung + 2 Monate | Nachweis eingereicht |
| BEG WG / NWG | Ende Bewilligungszeitraum | Zusage + 48 Monate | Abschluss |
| BEG WG / NWG | Verwendungsnachweis | Ende Bewilligungszeitraum + 6 Monate | Nachweis eingereicht |
| BEG EM Heizung (KfW) | Bestätigung zum Antrag läuft ab | BzA-Erstellung + 6 Monate | Antrag gestellt |
| alle | iSFP älter als 15 Jahre | iSFP-Datum + 15 Jahre | – |

## Übersicht für Benachrichtigungen

`GET /api/v1/deadlines/digest?days=14` liefert überfällige, in den nächsten *n* Tagen fällige und in der Erinnerungsphase befindliche offene Fristen – geeignet für einen täglichen Push (z. B. per n8n → ntfy).
