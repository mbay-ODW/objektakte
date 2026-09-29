# Zahlungen, offene Posten und Buchhaltungsexport

## Kontoumsätze übernehmen

- **CSV:** `POST /api/v1/bank/transactions/import-csv?account=<Konto>` mit dem Kontoauszug als `text/csv`. Spalten, Trennzeichen, Datums- und Zahlenformat werden einmalig unter `PUT /api/v1/settings/bank` (`csv`) hinterlegt – Standard ist das übliche deutsche Format (`;`, `dd.mm.yyyy`, Dezimalkomma, Spalten „Buchungstag“, „Betrag“, „Verwendungszweck“, …). Eine separate Soll/Haben-Spalte und Vorspannzeilen werden unterstützt.
- **JSON:** `POST /api/v1/bank/transactions/import` (z. B. aus einem Bank-API-Workflow).

Doppelte Umsätze werden erkannt (externe ID oder Hash der Umsatzdaten); eine Datei kann also gefahrlos mehrfach eingelesen werden.

## Automatischer Abgleich

Für jeden Zahlungseingang werden Vorschläge gegen die offenen Posten berechnet:

| Fall | Score |
|---|---|
| Belegnummer im Verwendungszweck (Schreibweise egal: `RE-2026-239`, `RE 2026 239`), Betrag passt | 0,97 |
| mehrere Belegnummern, Summe passt exakt | 0,9 je Beleg |
| Belegnummer, Teilzahlung | 0,8 |
| nur Betrag passt, Name ähnlich | 0,55 – 0,9 |

Ab `autoAllocateThreshold` (Standard 0,8) und nur bei eindeutigem Treffer wird automatisch zugeordnet; sonst bleiben die Vorschläge am Umsatz stehen. Manuell: `POST /api/v1/bank/transactions/{id}/allocate` (Teilbeträge, Aufteilung auf mehrere Rechnungen, Lösen), `…/ignore`, `POST /api/v1/bank/rematch`.

## Offene Posten und Vorgangsstatus

`GET /api/v1/receivables` listet festgeschriebene/versendete Rechnungen abzüglich zugeordneter Zahlungen, inklusive Verzug in Tagen.

Der **Vorgangsstatus wird aus Belegen und Zahlungen abgeleitet**, solange er nicht manuell gesetzt wurde:

| Fakten | Status |
|---|---|
| Angebot versendet | angebot |
| Auftragsbestätigung | beauftragt |
| Abschlagsrechnung | in_bearbeitung |
| (Schluss-)Rechnung offen | abrechnung |
| (Schluss-)Rechnungen vollständig bezahlt | abgeschlossen |

Manuelles Setzen (`PATCH /cases/{id}` mit `status`) markiert den Status als überschrieben; `POST /cases/{id}/status/auto` hebt das wieder auf.

## Auswertungen

`GET /api/v1/reports/revenue?from=…&to=…&basis=ist|soll`
- **ist:** nach Zahlungseingang (entspricht der Einnahmen-Überschuss-Rechnung), Netto/Steuer anteilig
- **soll:** nach Rechnungsdatum; Stornorechnungen mindern im Monat des Stornos

## Export für die Steuerberatung

- `GET /api/v1/exports/datev?from=…&to=…` – DATEV-Buchungsstapel (EXTF 700, Windows-1252). Einstellungen unter `PUT /api/v1/settings/datev`: Berater-/Mandantennummer, Kontenlänge, Modus `ist` (Bank an Erlöse bei Zahlung) oder `soll` (Debitor an Erlöse bei Rechnung, Bank an Debitor bei Zahlung), Konten (Standard SKR03: Bank 1200, Sammeldebitor 10000, Erlöse 8400/8337/8100 als Automatikkonten). **Vor produktiver Nutzung einen Probeimport mit der Steuerberatung abstimmen.**
- `GET /api/v1/exports/monthly?month=YYYY-MM` – ZIP mit DATEV-Stapel, Rechnungsausgangsliste, Zahlungseingängen, offenen Posten und allen Rechnungs-PDFs aus der Ablage; `hinweise.txt` nennt fehlende Belege.
