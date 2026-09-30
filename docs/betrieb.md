# Betrieb

Diese Anleitung beschreibt, wie objektakte betrieben wird: Installation, Konfiguration, Reverse Proxy, Backups, Updates und Fehlersuche.

## Komponenten

| Dienst | Image | Aufgabe | Zustand |
|---|---|---|---|
| `api` | `objektakte-api` (Root-`Dockerfile`) | REST-API, MCP, Webhook-Versand, Transkriptions-Worker | zustandslos bis auf die lokale Dateiablage `/data/files` |
| `web` | `objektakte-web` (`apps/web/Dockerfile`) | Büro-Oberfläche und PWA, reicht Anfragen an die API durch | zustandslos |
| `db` | `pgvector/pgvector:pg16` | Postgres | **alle Fachdaten** |
| `gotenberg` | `gotenberg/gotenberg:8` | HTML → PDF (Protokolle, Angebote) | zustandslos |
| `validator` | `objektakte-validator` (`validator/`) | Prüfung von XRechnung/ZUGFeRD inkl. PDF/A | zustandslos |
| Whisper | extern, optional | Transkription der Sprachnotizen | – |

Die API führt beim Start alle ausstehenden Datenbankmigrationen aus. Einen separaten Migrationsschritt gibt es nicht.

## Images

Bei jedem Push auf `main` baut GitHub Actions die Images und veröffentlicht sie:

```
ghcr.io/mbay-odw/objektakte-api:latest        (zusätzlich :sha-<kurz>, bei Tags :<version>)
ghcr.io/mbay-odw/objektakte-web:latest
ghcr.io/mbay-odw/objektakte-validator:latest
```

Selbst bauen, jeweils im Repository-Wurzelverzeichnis:

```bash
docker build -t objektakte-api .
docker build -f apps/web/Dockerfile -t objektakte-web .
docker build -t objektakte-validator validator
```

Ohne lokalen Checkout geht es auch direkt aus Git, z. B. über die Docker-API eines entfernten Hosts:

```bash
docker build -t objektakte-api https://github.com/mbay-ODW/objektakte.git#main
docker build -t objektakte-web -f apps/web/Dockerfile https://github.com/mbay-ODW/objektakte.git#main
docker build -t objektakte-validator https://github.com/mbay-ODW/objektakte.git#main:validator
```

## Variante A: `docker compose` (lokal, Test)

`docker-compose.yml` im Wurzelverzeichnis baut alle Images selbst und veröffentlicht die API auf Port 3000 und die Oberfläche auf Port 3001. Siehe den Schnellstart in der [README](../README.md#schnellstart-mit-docker).

## Variante B: hinter Traefik (z. B. als Portainer-Stack)

`deploy/docker-compose.traefik.yml` ist für den Dauerbetrieb gedacht:

- Es veröffentlicht keine Ports. Traefik routet über ein externes Netzwerk `traefik`.
- `db`, `gotenberg` und `validator` hängen nur im internen Netzwerk.
- **Oberfläche** läuft unter `https://$AKTE_HOST`, **API und MCP** unter `https://$AKTE_API_HOST` (Bearer-Token).
- Die Middlewares sind konfigurierbar. Standard sind Sicherheits-Header (HSTS, `nosniff`, kein Framing).

In Portainer: **Stacks → Add stack → Web editor**, den Inhalt von `deploy/docker-compose.traefik.yml` einfügen und die Variablen unter „Environment variables“ setzen. Alternativ **Repository** mit Compose-Pfad `deploy/docker-compose.traefik.yml`.

Zugangsdaten erzeugen:

```bash
openssl rand -hex 16   # POSTGRES_PASSWORD
openssl rand -hex 32   # API_TOKEN
openssl rand -hex 32   # WEB_SESSION_SECRET
```

Beispiel für die Stack-Variablen:

```
AKTE_HOST=akte.example.org
AKTE_API_HOST=akte-api.example.org
TRAEFIK_CERTRESOLVER=letsencrypt
POSTGRES_PASSWORD=…
API_TOKEN=…
WEB_PASSWORD=…
WEB_SESSION_SECRET=…
# optional: vorgeschalteter Login (Forward-Auth) für die Oberfläche
WEB_MIDDLEWARES=objektakte-headers@docker,forward-auth@file
```

Hinweise zu den Middlewares:

- **Oberfläche:** Ein vorgeschalteter Login (Forward-Auth, z. B. Authelia oder Authentik) ist empfehlenswert, solange es nur einen Benutzer mit Passwort gibt. Die PWA verträgt das, solange die Sitzung des Logins länger hält als eine Begehung ohne Netz. Aufträge, die wegen einer abgelaufenen Anmeldung scheitern (401), werden später erneut versucht.
- **API:** Die API unter `AKTE_API_HOST` nicht hinter Forward-Auth legen. MCP-Clients, n8n und Skripte authentifizieren sich per Bearer-Token und können keinen interaktiven Login durchlaufen. Eine Begrenzung der Anfragerate (`API_MIDDLEWARES`) ist sinnvoll.

## Konfiguration

### API (`apps/api`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `DATABASE_URL` | – (Pflicht) | Postgres-Verbindung |
| `API_TOKEN` | – (Pflicht, ≥ 8 Zeichen, empfohlen 64 Hex-Zeichen) | Bearer-Token für `/api/v1` und `/mcp` |
| `PORT` | `3000` | HTTP-Port |
| `STORAGE_BACKEND` | `local` | `local` (Verzeichnis) oder `nextcloud` (WebDAV) |
| `STORAGE_DIR` | `./data/files` | Ablageverzeichnis bei `local` (im Image `/data/files`) |
| `STORAGE_BASE_PATH` | `/objektakte` | Basisordner in der Ablage |
| `NEXTCLOUD_URL` | – | WebDAV-Basis, z. B. `https://cloud.example.org/remote.php/dav/files/benutzer` |
| `NEXTCLOUD_USER` / `NEXTCLOUD_PASSWORD` | – | Zugang; ein App-Passwort verwenden |
| `GOTENBERG_URL` | – | Gotenberg für PDF-Protokolle. Ohne diese Variable werden Protokolle als HTML abgelegt |
| `WHISPER_URL` | – | OpenAI-kompatibler Transkriptionsdienst (`POST /v1/audio/transcriptions`). Ohne diese Variable werden Sprachnotizen gespeichert, aber nicht transkribiert |
| `WHISPER_MODEL` | `Systran/faster-whisper-large-v3` | Modellname für den Dienst |
| `WHISPER_API_KEY` | – | optionaler Bearer-Token für den Dienst |
| `WORKER_INTERVAL_MS` | `10000` | Takt des Transkriptions-Workers |
| `WEBHOOK_INTERVAL_MS` | `5000` | Takt des Webhook-Versands |
| `EINVOICE_VALIDATOR_URL` | – | Validator-Dienst, z. B. `http://validator:8080` |
| `EINVOICE_VALIDATION` | `required` | `required`: Festschreiben nur nach bestandener externer Prüfung. `internal`: nur interne Regeln, **nur für Entwicklung** |

### Web (`apps/web`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `API_URL` | – (Pflicht) | API-Adresse ohne `/api/v1`, z. B. `http://api:3000` |
| `API_TOKEN` | – (Pflicht) | Token der API; bleibt auf dem Server |
| `WEB_PASSWORD` | – (Pflicht) | Anmeldepasswort |
| `WEB_SESSION_SECRET` | – (Pflicht, ≥ 32 Zeichen) | Signaturschlüssel des Sitzungscookies. Eine Änderung meldet alle Sitzungen ab |
| `ORIGIN` | – (Pflicht in Produktion) | öffentliche Adresse, z. B. `https://akte.example.org` |
| `WEB_COOKIE_SECURE` | in Produktion `true` | `false` nur lokal ohne HTTPS |
| `BODY_SIZE_LIMIT` | `80M` | maximale Anfragegröße (Fotos, Audio, Kontoauszüge) |
| `ADDRESS_HEADER`, `XFF_DEPTH` | – | hinter einem Proxy `X-Forwarded-For` bzw. `1`, damit die Anmeldebegrenzung die echte Client-Adresse sieht |

### Einstellungen in der Anwendung

Fachliche Konfiguration liegt in der Datenbank und wird über die Oberfläche (**Einstellungen**) oder die API (`/api/v1/settings/…`, `/api/v1/number-sequences`, `/api/v1/articles` usw.) gepflegt. Jede Änderung landet im Ereignisprotokoll.

- **Firmendaten:** Anschrift, Steuernummer/USt-IdNr., Bankverbindung, Kleinunternehmer, Nummernkreis-Muster, Standardtexte. Diese Angaben sind Pflicht, bevor die erste Rechnung festgeschrieben werden kann.
- **Leistungsarten und Nummernkreise** für Vorgänge
- **Förderprogramme und Fristenregeln:** Beispielregeln sind vorbelegt. Vor dem Einsatz fachlich prüfen, siehe [Fristen](fristen.md)
- **Kommunikation:** Schwellen der automatischen Zuordnung
- **Bank:** Spaltenzuordnung des CSV-Imports, Schwelle der automatischen Zuordnung
- **DATEV:** Berater- und Mandantennummer, Sachkontenlänge, Erlöskonten, Wirtschaftsjahresbeginn
- **Webhooks:** Ziel-URLs und Geheimnisse, siehe [Webhooks](webhooks.md)

## Anbindungen

- **Whisper:** Erwartet wird die OpenAI-kompatible Schnittstelle `POST {WHISPER_URL}/v1/audio/transcriptions` (Multipart mit `file` und `model`, Antwort `{ "text": … }`). Diese Schnittstelle bieten z. B. `faster-whisper-server`/`speaches` und `whisper.cpp` (Server-Modus). Ein Dienst mit anderer Schnittstelle braucht einen kleinen Adapter davor.
- **Nextcloud:** `STORAGE_BACKEND=nextcloud` legt Fotos, Audio, Protokolle und Belege unter `STORAGE_BASE_PATH` ab. Festgeschriebene Belege nicht außerhalb von objektakte verändern; ihr Hash steht im Ereignisprotokoll.
- **Automatisierung (z. B. n8n):** Nachrichten per `POST /api/v1/communications/ingest` einliefern (siehe [Kommunikation](kommunikation.md)), Änderungen per Webhook oder Ereignis-Feed abholen, Kontoauszüge per `POST /api/v1/bank/transactions/import-csv` importieren.
- **Datenübernahme:** über `POST /api/v1/import` im neutralen [Import-Format](import-format.md). Der Import ist idempotent (externe Referenzen), ein erneuter Lauf aktualisiert statt zu duplizieren.

## Backup und Wiederherstellung

Zu sichern sind **die Datenbank und die Dateiablage**, und zwar gemeinsam, damit Referenzen und Dateien zusammenpassen.

```bash
# Datenbank (konsistenter Schnappschuss im laufenden Betrieb)
docker compose exec -T db pg_dump -U objektakte -Fc objektakte > objektakte-$(date +%F).dump

# Dateiablage bei STORAGE_BACKEND=local (Volume „files“)
docker run --rm -v objektakte_files:/data -v "$PWD":/backup alpine \
  tar czf /backup/objektakte-files-$(date +%F).tgz -C /data .
```

Wiederherstellen in eine leere Datenbank:

```bash
docker compose exec -T db pg_restore -U objektakte -d objektakte --no-owner < objektakte-2026-01-31.dump
```

Die Trigger, die Ereignisprotokoll und festgeschriebene Belege schützen, verhindern auch das „Reparieren“ per SQL. Ein Restore ersetzt immer die ganze Datenbank.

**Aufbewahrung:** Rechnungen, Buchungsbelege und das Ereignisprotokoll unterliegen den steuerlichen Aufbewahrungsfristen (§ 147 AO, § 14b UStG). Backups entsprechend lange und unveränderbar aufbewahren und die [Verfahrensdokumentation](verfahrensdokumentation.md) ergänzen.

## Update

1. Backup erstellen (siehe oben).
2. Neue Images holen: `docker compose pull`. In Portainer „Pull and redeploy“ bzw. „Re-pull image“.
3. Neu starten. Die API führt die Migrationen beim Start aus und bricht bei einem Fehler ab, bevor sie Anfragen annimmt.

Migrationen sind vorwärtsgerichtet. Für ein Downgrade das Backup von vor dem Update einspielen.

## Überwachung

- `GET /health` an API und Web antwortet mit `200`. Die Images enthalten Docker-Healthchecks.
- Validator: `GET /health`. Ist er nicht erreichbar, antwortet das Festschreiben einer Rechnung mit `503`. Entwürfe und alle übrigen Funktionen arbeiten weiter.
- Webhooks: `GET /api/v1/webhooks` zeigt je Ziel die Zahl der Fehlversuche und den letzten Fehler.
- Transkriptionen: Status je Medium in der Begehung (`ausstehend`, `fertig`, `fehler`).

## Fehlersuche

| Symptom | Ursache / Abhilfe |
|---|---|
| API startet nicht, `API_TOKEN muss mindestens 8 Zeichen …` | Umgebungsvariablen prüfen; die API validiert sie beim Start |
| Login klappt, danach sofort wieder `/login` | `ORIGIN` passt nicht zur aufgerufenen Adresse, oder `WEB_COOKIE_SECURE` ist bei HTTP nicht `false` |
| Formulare melden „Cross-site POST form submissions are forbidden“ | `ORIGIN` entspricht nicht der öffentlichen Adresse (Schema + Host) |
| Festschreiben: `503 E-Rechnungs-Validator nicht erreichbar` | Validator-Container prüfen (`docker compose logs validator`). Der erste Start dauert einige Sekunden |
| Festschreiben: `422` mit Regelcodes (z. B. `BR-DE-…`) | Pflichtangaben fehlen. Die Vorprüfung in der Beleg-Ansicht nennt Feld und Regel |
| Uploads brechen ab | `BODY_SIZE_LIMIT` der Oberfläche und Limits im Reverse Proxy prüfen |
| Sprachnotizen bleiben „ausstehend“ | `WHISPER_URL` fehlt, oder der Dienst ist nicht OpenAI-kompatibel (siehe Anbindungen) |
