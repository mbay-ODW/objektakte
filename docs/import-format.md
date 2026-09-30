# Import-Format

`POST /api/v1/import` übernimmt Datenbestände aus beliebigen Quellen in einem neutralen JSON-Format. Adapter für konkrete Quellsysteme gehören **nicht** in dieses Repository; sie erzeugen lediglich dieses Format.

## Eigenschaften

- **Idempotent:** Jeder Datensatz trägt eine `externalId`. Zusammen mit `source` und dem Datensatztyp wird er beim nächsten Import wiedererkannt und nur bei Änderungen aktualisiert. Ein Import kann also beliebig oft wiederholt werden (z. B. als nächtlicher Abgleich während einer Übergangszeit).
- **Atomar:** Tritt ein Problem auf (unbekannte Referenz, doppelte Belegnummer …), wird der gesamte Batch zurückgerollt; die Antwort `422` listet alle Probleme.
- **Probelauf:** Mit `"dryRun": true` wird alles geprüft und gezählt, aber nichts gespeichert.
- **Protokolliert:** Jede Anlage/Änderung erzeugt ein Ereignis `<typ>.imported` mit `{ source, externalId, action }`.

Referenzen zwischen Datensätzen erfolgen über externe IDs (`customerExternalId`, `caseExternalId`, …). Sie dürfen auf Datensätze desselben Batches oder früherer Importe mit derselben `source` zeigen.

Verarbeitungsreihenfolge: Kontakte → Objekte → Vorgänge → Dokumente → Kommunikation → Belege.

## Beispiel

```json
{
  "source": "altbestand",
  "dryRun": true,
  "contacts": [
    {
      "externalId": "k1",
      "kind": "person",
      "firstName": "Max",
      "lastName": "Muster",
      "customerNumber": "1001",
      "street": "Musterweg 1",
      "postalCode": "12345",
      "city": "Musterstadt",
      "channels": [{ "kind": "email", "value": "max@example.org", "isPrimary": true }]
    },
    {
      "externalId": "k2",
      "kind": "organisation",
      "organisationName": "Gemeinde Beispielhausen",
      "leitwegId": "991-12345-67"
    }
  ],
  "objects": [
    {
      "externalId": "o1",
      "label": "EFH Musterweg 1",
      "city": "Musterstadt",
      "usage": "wohngebaeude",
      "constructionYear": 1968,
      "roles": [{ "contactExternalId": "k1", "role": "eigentuemer" }]
    }
  ],
  "cases": [
    {
      "externalId": "p1",
      "number": "ISFP-001",
      "title": "iSFP Musterweg 1",
      "customerExternalId": "k1",
      "objectExternalId": "o1",
      "measureCode": "ISFP",
      "measureName": "Individueller Sanierungsfahrplan",
      "status": "abgeschlossen",
      "openedAt": "2026-02-01"
    }
  ],
  "communications": [
    {
      "externalId": "m1",
      "caseExternalId": "p1",
      "channel": "email",
      "direction": "eingehend",
      "occurredAt": "2026-02-02T09:30:00+01:00",
      "subject": "Unterlagen",
      "body": "…"
    }
  ],
  "documents": [
    {
      "externalId": "d1",
      "caseExternalId": "p1",
      "title": "RE-2026-001.pdf",
      "docClass": "rechnung",
      "storage": "nextcloud",
      "location": "/Projekte/ISFP-001/RE-2026-001.pdf"
    }
  ],
  "billingDocuments": [
    {
      "externalId": "b1",
      "type": "rechnung",
      "number": "RE-2026-001",
      "caseExternalId": "p1",
      "contactExternalId": "k1",
      "issueDate": "2026-04-15",
      "netCents": 100840,
      "taxCents": 19160,
      "grossCents": 120000,
      "status": "versendet",
      "pdfDocumentExternalId": "d1"
    }
  ]
}
```

## Felder und Wertebereiche

Die vollständige, maschinenlesbare Beschreibung liefert `GET /openapi.json` (Schema `ImportBatch`). Wichtige Wertebereiche:

| Feld | Werte |
|---|---|
| `contacts[].kind` | `person`, `organisation` |
| `contacts[].channels[].kind` | `email`, `phone`, `mobile`, `whatsapp`, `signal`, `fax`, `website` |
| `objects[].usage` | `wohngebaeude`, `nichtwohngebaeude`, `gemischt`, `unbekannt` |
| `objects[].roles[].role` | `eigentuemer`, `verwaltung`, `nutzer`, `ansprechpartner`, `handwerker`, `planer`, `sonstige` |
| `cases[].status` | `anfrage`, `angebot`, `beauftragt`, `in_bearbeitung`, `abrechnung`, `abgeschlossen`, `storniert` |
| `communications[].channel` | `email`, `whatsapp`, `signal`, `telefon`, `vor_ort`, `brief`, `notiz` |
| `communications[].direction` | `eingehend`, `ausgehend`, `intern` |
| `documents[].storage` | `nextcloud`, `paperless`, `url` |
| `billingDocuments[].type` | `angebot`, `auftragsbestaetigung`, `rechnung`, `abschlagsrechnung`, `schlussrechnung`, `stornorechnung`, `gutschrift`, `zahlungserinnerung`, `zahlungsbestaetigung` |
| `billingDocuments[].status` | `entwurf`, `festgeschrieben`, `versendet`, `storniert` |

Beträge werden in **Cent** (Ganzzahl) übergeben; `netCents + taxCents` muss `grossCents` ergeben. Importierte Belege werden als Archivkopien (`source = import`) geführt und nicht erneut festgeschrieben.

## Datenschutz

Importdateien enthalten personenbezogene Daten. Sie gehören nie ins Repository (`import-data/` und `*.import.json` sind in `.gitignore` ausgeschlossen).
