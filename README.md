# objektakte

**Fallakte für Energieberatung.** Hier liegt alles an einem Ort: Kontakte, Gebäude, Vorgänge, Förderfälle mit berechneten Fristen, Kommunikation, Begehungen vor Ort sowie GoBD-konforme Rechnungen mit E-Rechnung. objektakte ist selbst gehostet und API-first gebaut.

[![CI](https://github.com/mbay-ODW/objektakte/actions/workflows/ci.yml/badge.svg)](https://github.com/mbay-ODW/objektakte/actions/workflows/ci.yml)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-blue.svg)](LICENSE)

> **Status:** Funktional vollständig (Ausbaustufen 0–5), aber noch nicht im Produktivbetrieb erprobt. Vor dem Einsatz Firmendaten, Nummernkreise, Fristenregeln und DATEV-Konten prüfen und die [Verfahrensdokumentation](docs/verfahrensdokumentation.md) an den eigenen Betrieb anpassen.

---

## Wofür?

Kleine Energieberatungsbüros betreuen viele geförderte Vorgänge gleichzeitig: Sanierungsfahrplan, Einzelmaßnahme, Verwendungsnachweis. Oft laufen diese über Jahre am selben Gebäude, mit wechselnden Beteiligten und harten Förderfristen. Allgemeine Handwerker- oder CRM-Software bildet das kaum ab. Der Rest landet in Tabellen, Erinnerungen und Mailordnern.

objektakte stellt deshalb das **Gebäude** in den Mittelpunkt und modelliert den **Förderfall** als eigene Fachlichkeit.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Stammdaten** | Kontakte (Personen, Firmen, Behörden inkl. Leitweg-ID) und Objekte mit Beteiligten und Rollen (Eigentümer, Verwaltung, Handwerker, Planer …) |
| **Vorgänge** | Nummernkreise und Leistungsarten. Der Status wird **aus Fakten abgeleitet** (Angebot angenommen, Rechnung versendet, bezahlt), lässt sich manuell überschreiben und wird dann markiert |
| **Förderfälle & Fristen** | Programme, Richtlinienstand, Antrags- und Nachweis-IDs. Fristen sind **Regeln** (Anker + Versatz, Monatsarithmetik nach § 188 BGB) und gelten automatisch als erledigt, sobald ihre Bedingung erfüllt ist. Dazu Wiedervorlagen und ein Fristen-Digest |
| **Kommunikation** | Ingest von E-Mail, Messenger, Telefon und Notizen. **Automatische Zuordnung** mit Konfidenz über Vorgangsnummer, bekannte Kanäle, Objektrollen und Inhalt. Zuordnungs-Inbox mit „Kanal lernen“, Neuanfragen als Leads, Timeline je Kontakt, Objekt und Vorgang |
| **Begehung vor Ort** | Offline-fähige PWA fürs Smartphone: Positionen nach Bauteil/Anlage, verkleinerte Fotos, **Sprachnotizen mit Whisper-Transkription**, Warteschlange mit idempotentem Sync und ein festgeschriebenes Protokoll als PDF |
| **Dokumente** | Referenzen auf Dateien in lokaler Ablage oder in Nextcloud (WebDAV). PDFs werden über Gotenberg erzeugt |
| **Angebote & Rechnungen** | Angebot, Auftragsbestätigung, Rechnung, Abschlags- und Schlussrechnung (Abzüge nach § 14 Abs. 5 UStG), Storno, Gutschrift, Zahlungserinnerung und ein Artikelstamm. **GoBD-Festschreibung** über Datenbank-Trigger; die lückenlose Belegnummer wird erst beim Festschreiben vergeben |
| **E-Rechnung** | Ein kanonisches EN-16931-Modell erzeugt **XRechnung 3.0 (CII)** und **ZUGFeRD/Factur-X EN16931** (PDF/A-3b mit eingebettetem XML). Die externe Prüfung (Schematron + veraPDF) läuft **vor** dem Festschreiben. Unterstützt werden Kleinunternehmer (§ 19 UStG), Reverse Charge und steuerbefreite Umsätze |
| **Eingangsrechnungen** | XRechnung (CII/UBL) und ZUGFeRD-PDF einlesen; die Daten werden aus dem XML übernommen |
| **Zahlungen** | Kontoauszug-Import (CSV mit konfigurierbarer Spaltenzuordnung oder JSON) mit Dublettenschutz. **Automatischer Abgleich** gegen offene Posten, auch für Teil- und Sammelzahlungen |
| **Auswertungen & Export** | Offene Posten, Umsatz nach Soll und Ist, **DATEV-Buchungsstapel** (EXTF 700) und ein Monatspaket (ZIP mit Belegen) für die Steuerberatung |
| **Integration** | REST/OpenAPI 3.1, **MCP-Server** (jede API-Operation ist ein Tool), append-only-Ereignisprotokoll, Ereignis-Feed, **signierte Webhooks** und ein idempotenter Import |

## Architektur

```
   Browser / PWA „Vor Ort“        KI-Assistent (MCP)        n8n, Skripte
            │                             │                       │
            ▼                             ▼                       ▼
   ┌─────────────────┐  Bearer   ┌────────────────────────────────────────┐
   │ web (SvelteKit) │ ────────► │ api (Hono, modularer Monolith)         │
   │ Büro-UI + PWA   │  Token    │  /api/v1 · /openapi.json · /mcp        │
   └─────────────────┘           │  contacts · objects · cases · funding  │
                                 │  communications · inspections · docs   │
                                 │  billing · payments · reports · hooks  │
                                 └────┬──────────────┬──────────────┬─────┘
                                      ▼              ▼              ▼
                           Postgres 16 +     Gotenberg (PDF)   Dateiablage
                           events (append-   Validator (E-Re.) (lokal oder
                           only)             Whisper (Audio)    Nextcloud)
```

- **Ein Backend, ein Schema:** Die API beschreibt sich per OpenAPI. MCP-Tools und die Typen der Web-Oberfläche werden daraus erzeugt, und CI prüft das. Damit können API, Oberfläche und Assistent nicht auseinanderlaufen.
- **Unveränderliche Fakten in der Datenbank:** Ereignisprotokoll, festgeschriebene Belege und abgeschlossene Begehungen sind per Trigger gegen Änderungen geschützt, nicht nur per Anwendungslogik.
- **Externe Dienste als austauschbare Adapter:** Speicher, PDF-Renderer, Transkription und E-Rechnungs-Prüfung liegen hinter Schnittstellen und sind in Tests ersetzbar.

Mehr dazu im [Konzept](docs/konzept.md).

## Schnellstart mit Docker

```bash
git clone https://github.com/mbay-ODW/objektakte.git && cd objektakte
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
API_TOKEN=$(openssl rand -hex 32)
WEB_PASSWORD=bitte-aendern
WEB_SESSION_SECRET=$(openssl rand -hex 32)
WEB_ORIGIN=http://localhost:3001
WEB_COOKIE_SECURE=false
EOF
docker compose up -d --build
```

Danach erreichbar:

- Oberfläche: <http://localhost:3001> (Anmeldung mit `WEB_PASSWORD`)
- API: <http://localhost:3000/openapi.json>, Aufrufe mit `Authorization: Bearer $API_TOKEN`
- MCP: `http://localhost:3000/mcp`

Erste Schritte in der Oberfläche:

1. Unter **Einstellungen → Firmendaten** Anschrift, Steuernummer bzw. USt-IdNr., Bankverbindung und Nummernkreise pflegen.
2. Dann Kontakt, Objekt und Vorgang anlegen.

Betrieb hinter einem Reverse Proxy (Traefik, Portainer), Backups und Updates beschreibt **[Betrieb](docs/betrieb.md)**.

## MCP-Client anbinden

```json
{
  "mcpServers": {
    "objektakte": {
      "type": "http",
      "url": "https://akte-api.example.org/mcp",
      "headers": { "Authorization": "Bearer <API_TOKEN>" }
    }
  }
}
```

Der Server arbeitet zustandslos (Streamable HTTP). Jede API-Operation mit `operationId` wird automatisch zum Tool, derzeit 85. Ausgenommen sind Operationen mit `"x-mcp": false`, z. B. Datei-Downloads.

## Entwicklung

Voraussetzungen: Node.js ≥ 22.12, pnpm 10 und Postgres 16. Java 21 brauchst du nur für den E-Rechnungs-Validator.

```bash
pnpm install
cp .env.example .env               # DATABASE_URL, API_TOKEN …
pnpm --filter @objektakte/api db:migrate
pnpm --filter @objektakte/api dev  # http://localhost:3000

# zweites Terminal
cd apps/web
API_URL=http://localhost:3000 API_TOKEN=… WEB_PASSWORD=… \
WEB_SESSION_SECRET=$(openssl rand -hex 32) pnpm dev
```

| Befehl | Zweck |
|---|---|
| `pnpm lint` / `pnpm format` | Biome (Lint + Formatierung); Warnungen gelten als Fehler |
| `pnpm typecheck` | TypeScript und `svelte-check` |
| `pnpm test` | API- und Web-Tests. Die API braucht `TEST_DATABASE_URL`, Default ist die lokale DB `objektakte_test` |
| `pnpm --filter @objektakte/web test:e2e` | Playwright-Ende-zu-Ende-Tests |
| `pnpm api:types` | Typen der Web-Oberfläche aus der OpenAPI-Beschreibung neu erzeugen |
| `pnpm --filter @objektakte/api db:generate` | Migration aus `apps/api/src/db/schema.ts` erzeugen und einchecken |

Ist `EINVOICE_VALIDATOR_URL` gesetzt, laufen die E-Rechnungs-Tests gegen den echten Validator (siehe [validator/README.md](validator/README.md)). Ohne diese Variable prüfen sie nur die internen Regeln.

### Projektstruktur

```
apps/api          Backend (Hono, Drizzle, Postgres), Module unter src/modules/*
apps/api/drizzle  SQL-Migrationen inkl. Trigger (GoBD, Ereignisprotokoll)
apps/web          Büro-Oberfläche und PWA „Vor Ort“ (SvelteKit)
validator         E-Rechnungs-Validator als kleiner HTTP-Dienst
deploy            Compose-Datei für den Betrieb hinter Traefik
docs              Fach- und Betriebsdokumentation
```

## Dokumentation

**Betrieb**
- [Installation, Betrieb, Backup, Update](docs/betrieb.md)
- [Konfiguration (Umgebungsvariablen)](docs/betrieb.md#konfiguration)
- [E-Rechnungs-Validator](validator/README.md)

**Fachlich**
- [Konzept und Architektur](docs/konzept.md)
- [Fristen und Förderfälle](docs/fristen.md)
- [Kommunikation und Zuordnung](docs/kommunikation.md)
- [Begehung vor Ort](docs/begehung.md)
- [Angebote, Rechnungen und E-Rechnung](docs/rechnungen.md)
- [Zahlungen und Export](docs/zahlungen.md)
- [Verfahrensdokumentation (Muster)](docs/verfahrensdokumentation.md)

**Schnittstellen**
- [Web-Oberfläche und PWA](docs/web.md)
- [Ereignisse und Webhooks](docs/webhooks.md)
- [Import-Format](docs/import-format.md) für die Datenübernahme aus anderen Systemen

## Sicherheit

- Die API kennt genau ein Bearer-Token, und es hat volle Rechte. Es gehört nur auf Server und in vertrauenswürdige Automatisierungen, nie in den Browser. Die Web-Oberfläche reicht Anfragen deshalb serverseitig durch.
- Die Web-Oberfläche hat genau einen Benutzer (Passwort, signiertes Sitzungscookie, Begrenzung der Anmeldeversuche). Wer mehr Schutz will, schaltet einen Login vor, z. B. Forward-Auth am Reverse Proxy.
- Sicherheitsprobleme bitte nicht als öffentliches Issue melden, sondern über die [private Meldefunktion von GitHub](https://github.com/mbay-ODW/objektakte/security/advisories/new).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Wer objektakte verändert und als Netzwerkdienst anbietet, muss den Nutzern den Quelltext der geänderten Fassung zugänglich machen.

Der E-Rechnungs-Validator nutzt das [Mustang-Projekt](https://www.mustangproject.org/) (Apache-2.0), das die Prüfregeln der KoSIT und veraPDF einbindet.
