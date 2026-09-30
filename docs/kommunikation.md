# Kommunikation und Zuordnung

E-Mails, Messenger-Nachrichten, Telefonnotizen und Vor-Ort-Notizen landen als strukturierte Datensätze in einer gemeinsamen Chronik je Vorgang und Kontakt.

## Übernahme

Adapter (z. B. ein n8n-Workflow je Postfach oder Messenger) senden Nachrichten an

```
POST /api/v1/communications/ingest
{ "messages": [ { "source": "postfach-info", "sourceRef": "<message-id>", "channel": "email",
                  "direction": "eingehend", "occurredAt": "…", "subject": "…", "body": "…",
                  "participants": [ { "role": "from", "address": "kunde@example.org" } ],
                  "attachments": [ { "title": "Plan.pdf", "storage": "nextcloud", "location": "/…" } ] } ] }
```

`source` + `sourceRef` machen die Übernahme idempotent: dieselbe Nachricht kann beliebig oft gesendet werden. Anhänge werden nur als Referenz (Dateiablage) gespeichert.

## Automatische Zuordnung

1. **Vorgangsnummer im Betreff/Text** (als ganzes Wort) → Zuordnung mit Konfidenz 0,95.
2. **Gegenüber erkennen**: Absender (eingehend) bzw. Empfänger (ausgehend) werden normalisiert (E-Mail klein, Telefonnummern international) und mit den Kanälen der Kontakte verglichen. Eigene Adressen werden ignoriert.
3. **Vorgang wählen** unter den offenen Vorgängen, bei denen der Kontakt Kunde ist *oder* über eine Objektrolle beteiligt ist (z. B. Hausverwaltung):
   - genau einer → Konfidenz 0,8
   - mehrere → Bewertung nach Straße/Objekt/Ort/Titel im Text; nur ein klarer Treffer wird übernommen
   - keiner → Kontakt wird gesetzt, Vorgang bleibt offen („mögliche Neuanfrage“)

Ab dem Schwellwert (`autoAssignThreshold`, Standard 0,7) wird automatisch zugeordnet (`automatisch`), sonst landet die Nachricht in der **Zuordnungs-Inbox** (`offen`). Mehrdeutige Fälle bringen eine Kandidatenliste mit.

## Zuordnungs-Inbox

- `GET /api/v1/communications/inbox` – offene und automatisch zugeordnete, unbestätigte Nachrichten
- `POST …/{id}/assign` – manuell zuordnen; mit `learnChannel: true` wird die Adresse dem Kontakt als Kanal hinzugefügt
- `POST …/{id}/confirm` – automatische Zuordnung bestätigen
- `POST …/{id}/ignore` – ignorieren
- `POST …/{id}/lead` – Neuanfrage: Kontakt (inkl. Absenderkanal) und Vorgang im Status „anfrage“ anlegen
- `POST /api/v1/communications/rematch` – offene Nachrichten erneut zuordnen (z. B. nach neuen Kanälen)

## Einstellungen

`PUT /api/v1/settings/communication`:

```json
{ "ownAddresses": ["info@beratung.example", "+49 …"], "ignoredAddresses": ["newsletter@…"], "autoAssignThreshold": 0.7 }
```

## Chronik

`GET /api/v1/timeline?caseId=…` bzw. `?contactId=…` führt Nachrichten und fachliche Ereignisse (Statuswechsel, Förderfall, Fristen) zeitlich zusammen.
