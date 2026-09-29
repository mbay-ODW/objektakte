# Web-Oberfläche

`apps/web` ist die Büro-Oberfläche und zugleich die PWA „Vor Ort“ für Begehungen. Sie ist mit SvelteKit (Svelte 5) gebaut, läuft als Node-Server (`adapter-node`) und spricht ausschließlich die API (`/api/v1`) an.

## Einrichtung

```bash
pnpm install
# API starten (siehe README), dann:
cd apps/web
API_URL=http://localhost:3000 API_TOKEN=… WEB_PASSWORD=… \
WEB_SESSION_SECRET=$(openssl rand -hex 32) pnpm dev
```

| Variable | Bedeutung |
|---|---|
| `API_URL` | Basisadresse der API ohne `/api/v1`, z. B. `http://api:3000` |
| `API_TOKEN` | Bearer-Token der API – bleibt auf dem Server, der Browser sieht es nie |
| `WEB_PASSWORD` | Passwort für die Anmeldung (ein Benutzer) |
| `WEB_SESSION_SECRET` | Schlüssel für die Signatur des Sitzungscookies, mindestens 32 Zeichen |
| `ORIGIN` | Öffentliche Adresse, z. B. `https://akte.example.org` (nötig für die CSRF-Prüfung hinter einem Reverse Proxy) |
| `WEB_COOKIE_SECURE` | optional; `false` erlaubt das Cookie ohne HTTPS (Standard: nur in der Entwicklung) |
| `BODY_SIZE_LIMIT` | maximale Anfragegröße, im Docker-Image `80M` (Fotos, Sprachnotizen, Kontoauszüge, Eingangsrechnungen) |
| `ADDRESS_HEADER` | hinter einem Reverse Proxy z. B. `X-Forwarded-For`, damit die Anmeldebegrenzung die echte Client-Adresse sieht (siehe `adapter-node`) |

Produktion: `pnpm --filter @objektakte/web build` und `node apps/web/build`, oder per Docker (`apps/web/Dockerfile`, Dienst `web` in `docker-compose.yml`; dort zusätzlich `WEB_PASSWORD`, `WEB_SESSION_SECRET` und `WEB_ORIGIN` setzen).

## Anmeldung

Es gibt genau einen Benutzer. Das Passwort wird in konstanter Laufzeit mit `WEB_PASSWORD` verglichen; danach setzt der Server ein signiertes Sitzungscookie (`HMAC-SHA256`, `httpOnly`, `SameSite=Lax`, in Produktion `Secure`, 30 Tage gültig). `hooks.server.ts` prüft jede Anfrage: Seiten leiten ohne Sitzung auf `/login` um, Datenpfade (`/api-proxy`, `/dokumente`) antworten mit `401`. Abmelden löscht das Cookie und die zwischengespeicherten Daten des Service Workers.

Fehlgeschlagene Anmeldungen werden je Client-Adresse gezählt: nach 5 Fehlversuchen innerhalb von 15 Minuten antwortet das Login mit `429` („Zu viele Fehlversuche …“), bis das Zeitfenster abgelaufen ist. Eine erfolgreiche Anmeldung setzt den Zähler zurück. Die Begrenzung liegt im Speicher des Prozesses (ein Neustart setzt sie zurück).

## Zugriff auf die API

- **Serverseitig:** Load-Funktionen und Form-Actions nutzen einen typisierten Client (`openapi-fetch`) mit den aus der OpenAPI-Beschreibung erzeugten Typen (`src/lib/api/schema.d.ts`). Nach API-Änderungen: `pnpm api:types` (exportiert die Spezifikation ohne Datenbank und erzeugt die Typen neu). CI prüft, dass die Typen aktuell sind.
- **Browser (PWA):** `/api-proxy/<pfad>` leitet an `${API_URL}/api/v1/<pfad>` weiter (Methode, Query, Body einschließlich multipart) und ergänzt das Token. Nur für angemeldete Sitzungen und nur, wenn die Anfrage den Header `x-objektakte-client: 1` trägt und von derselben Origin stammt (`Origin`/`Sec-Fetch-Site`). Der eigene Header erzwingt bei fremden Seiten einen CORS-Preflight, der nie erlaubt wird. Formulare der Büro-Oberfläche sind zusätzlich durch die Origin-Prüfung von SvelteKit geschützt.
- **Dokumente:** `/dokumente/<id>` lädt Dateien über `/documents/{id}/file` (mit `?download` als Anhang). HTML-Protokolle werden mit einer Sandbox-CSP ausgeliefert.

## Büro-Oberfläche

Übersicht (Fristen-Digest, Inbox, Vorgänge je Status), Kontakte, Objekte (Beteiligte, Begehungen), Vorgänge als Liste mit Filtern und als Board nach Status, Vorgangsakte (Stammdaten, Förderfälle mit berechneten Fristen, Fristen und Wiedervorlagen, Chronik, Nachrichten, Dokumente, Begehungen), Fristen, Zuordnungs-Inbox (zuordnen mit „Kanal lernen“, bestätigen, ignorieren, Neuanfrage, erneut zuordnen) und Einstellungen (Kommunikation, Leistungsarten, Nummernkreise, Förderprogramme, Fristenregeln, Webhooks).

## Finanzen

Die Navigation gruppiert **Arbeit** (Übersicht, Vorgänge, Inbox, Fristen, Vor Ort), **Stammdaten** (Kontakte, Objekte), **Finanzen** und **Einstellungen**. Grundlagen siehe [Rechnungen](rechnungen.md) und [Zahlungen](zahlungen.md).

- **Belege** (`/belege`): Liste mit Filtern nach Art, Status, Kunde und Vorgang. Der Editor für Entwürfe umfasst Kunde, Vorgang, Datumsangaben inkl. Leistungszeitraum, Leitweg-ID/Käuferreferenz, Texte, E-Rechnungsformat und Positionen (Artikel aus dem Stamm, Einheiten nach UN/ECE Rec. 20, Steuerkategorie und -satz) mit live berechneten Summen. Die Vorprüfung der API (`…/check`) steht oben auf der Seite; bei Problemen ist das Festschreiben gesperrt. Die PDF-Vorschau (`/belege/<id>/vorschau`) wird serverseitig durchgereicht.
  **Festschreiben** verlangt eine ausdrückliche Bestätigung in einem Dialog, der erklärt, dass der Schritt nicht umkehrbar ist (GoBD). Danach zeigt die Detailansicht PDF/XML, das Prüfergebnis der E-Rechnung, offene Beträge und die Folgeaktionen: als versendet markieren, in Rechnung/neuen Entwurf umwandeln, stornieren (mit Bestätigung), Zahlungserinnerung (Stufe, Gebühr, Frist).
  In der Vorgangsakte erscheinen alle Belege des Vorgangs mit „Angebot erstellen“ und „Rechnung erstellen“.
- **Zahlungen** (`/zahlungen`): Kontoauszug als CSV hochladen (der Server liest die Datei – UTF-8 oder Windows-1252 – und sendet sie als `text/csv` an die API), Umsätze nach Status filtern, Vorschläge mit einem Klick übernehmen, manuell zuordnen (auch aufgeteilt auf mehrere Rechnungen), ignorieren, erneut abgleichen.
- **Offene Posten** (`/offene-posten`): offene Rechnungen mit Hervorhebung überfälliger Posten und direkter Zahlungserinnerung. Die Übersicht zeigt Summe und Zahl der überfälligen Posten.
- **Eingang** (`/eingang`): XRechnung-XML oder ZUGFeRD-PDF hochladen, Liste mit Status (offen, geprüft, bezahlt, abgelehnt), Originaldatei öffnen.
- **Auswertungen** (`/auswertungen`): Umsatz je Monat nach Soll und Ist als SVG-Säulendiagramm mit Tabelle; Downloads für den DATEV-Buchungsstapel und das Monatspaket (serverseitig durchgereicht).
- **Einstellungen**: zusätzlich Firmendaten (inkl. Kleinunternehmer, Verkäuferkennung, Nummernkreis-Muster, Standardtexte), Artikel, Bank-CSV-Zuordnung und DATEV.

## Begehung vor Ort (offline)

`/vor-ort` ist für das Smartphone gedacht und lässt sich als App installieren (Manifest + Service Worker). Die Seite läuft vollständig im Browser; Daten liegen in IndexedDB.

1. **Objekt wählen:** Die Objektliste (mit Vorgängen je Objekt) wird bei Verbindung aktualisiert und für den Offline-Betrieb gespeichert.
2. **Begehung starten:** Die ID erzeugt das Gerät (`crypto.randomUUID()`), dazu Anlass, Vorgang, Teilnehmende, Witterung und Notizen.
3. **Positionen erfassen:** Kategorie, Bezeichnung, Lage, Zustand (gut/mittel/schlecht), freie Merkmale und Notizen.
4. **Fotos:** Kamera oder Galerie; das Bild wird vor dem Speichern auf JPEG mit höchstens 1600 px Kantenlänge (Qualität 0,8) verkleinert.
5. **Sprachnotizen:** Aufnahme als WebM/Opus, in Safari als MP4/AAC. Transkripte erscheinen nach der Übertragung („Serverstand aktualisieren“).

Jede Änderung wird zuerst lokal gespeichert und als Auftrag in eine **Warteschlange** in IndexedDB geschrieben (`PUT` Begehung, `PUT`/`DELETE` Position, `PUT` Medium als multipart, Abschluss). Die Aufträge werden streng in Reihenfolge über `/api-proxy` übertragen – automatisch bei Verbindung, alle paar Sekunden oder per „Jetzt synchronisieren“. Da alle Schreibzugriffe idempotent sind (Client-IDs), sind Wiederholungen unkritisch.

- Netzfehler und Serverfehler (5xx, 401) → erneuter Versuch mit exponentiell wachsender Wartezeit (2 s bis 5 min).
- Fachliche Fehler (4xx) → der Auftrag wird als fehlerhaft markiert und hält nur die betroffene Begehung an; er kann verworfen oder erneut versucht werden.
- Die Leiste oben zeigt Online-Status, Zahl der ausstehenden Aufträge und den letzten Fehler.
- **Abschließen** ist erst möglich, wenn alle Aufträge der Begehung übertragen sind. Danach wird die Begehung festgeschrieben und das Protokoll erzeugt; der Link zum Protokoll erscheint direkt in der App.

Der Service Worker hält App-Shell und die Vor-Ort-Seite vor (Netz zuerst, bei fehlender Verbindung aus dem Cache) und puffert lesende Proxy-Aufrufe als Rückfall. Die Logik der Warteschlange (`src/lib/offline/`) ist unabhängig von Svelte und mit Unit-Tests (`fake-indexeddb`) abgedeckt.

## Tests

```bash
pnpm --filter @objektakte/web typecheck   # svelte-check
pnpm --filter @objektakte/web test        # Unit-Tests (Vitest)
pnpm --filter @objektakte/web test:e2e    # Playwright
```

Die E2E-Tests starten die API aus diesem Repository (Port 3100) und die gebaute Web-App (Port 4300). Ist `EINVOICE_VALIDATOR_URL` gesetzt (in CI der Mustang-Validator aus [`/validator`](../validator/README.md)), werden festgeschriebene Rechnungen echt geprüft, sonst läuft die API mit `EINVOICE_VALIDATION=internal`. Die Datenbank `E2E_DATABASE_URL` (Standard: lokale `objektakte_web`) wird dabei **vollständig zurückgesetzt**; aus Sicherheitsgründen muss ihr Name `web` oder `e2e` enthalten. Ein vorhandenes Chromium lässt sich über `PLAYWRIGHT_CHROMIUM_EXECUTABLE` angeben, sonst `npx playwright install chromium`.
