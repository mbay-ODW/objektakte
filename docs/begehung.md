# Begehung vor Ort

Die Begehung ist für die Arbeit mit dem Smartphone/Tablet ohne verlässliches Netz ausgelegt.

## Offline-Prinzip

Alle IDs (Begehung, Position, Medium) erzeugt der Client selbst (UUID). Jede Schreiboperation ist ein idempotentes `PUT`; eine Offline-Warteschlange kann Aufträge daher beliebig oft wiederholen, ohne Duplikate zu erzeugen.

| Aktion | Endpunkt |
|---|---|
| Begehung anlegen/ändern | `PUT /api/v1/inspections/{id}` |
| Position (Bauteil, Anlage, Zone) | `PUT /api/v1/inspections/{id}/items/{itemId}` |
| Foto / Sprachnotiz (multipart) | `PUT /api/v1/inspections/{id}/media/{mediaId}` |
| Abschließen | `POST /api/v1/inspections/{id}/finalize` |

Positionen haben eine Kategorie (Außenwand, Dach, Fenster, Heizung, Lüftung, Beleuchtung, Zone/Nutzung …), einen Zustand und frei wählbare Merkmale (`attributes`, z. B. `{"material": "Holz", "baujahr": 1985}`).

## Dateien

Fotos und Sprachnotizen werden in der Dateiablage abgelegt – bevorzugt im Ordner des Objekts (`storagePath`), sonst unter `STORAGE_BASE_PATH/objekte/…`. In der Datenbank steht nur die Referenz samt SHA-256.

Unterstützte Ablagen (`STORAGE_BACKEND`):
- `nextcloud` – WebDAV mit App-Passwort (`NEXTCLOUD_URL` = `https://…/remote.php/dav/files/<benutzer>`, `NEXTCLOUD_USER`, `NEXTCLOUD_PASSWORD`)
- `local` – Verzeichnis `STORAGE_DIR`

## Sprachnotizen

Ist `WHISPER_URL` gesetzt, werden Sprachnotizen im Hintergrund transkribiert (OpenAI-kompatible Schnittstelle `POST /v1/audio/transcriptions`, wie sie z. B. faster-whisper-server/speaches oder LocalAI anbieten; Modell über `WHISPER_MODEL`). Bis zu drei Versuche; danach Status `fehler`, erneuter Anstoß per `POST /api/v1/inspection-media/{id}/transcribe`. Transkripte dürfen auch nach Abschluss der Begehung noch eintreffen.

## Abschluss

`finalize` schreibt die Begehung fest (SHA-256 über den kanonischen Inhalt), erzeugt einen Eintrag in der Chronik des Vorgangs und das **Begehungsprotokoll** (PDF über Gotenberg, `GOTENBERG_URL`; ohne Renderer als HTML). Danach verhindern Datenbank-Trigger jede Änderung an Begehung, Positionen und Medien. Ist der Renderer beim Abschluss nicht erreichbar, lässt sich das Protokoll mit `POST …/protocol` nachträglich erzeugen.
