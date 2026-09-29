# objektakte

Fallakte für Energieberatung: Kontakte, Gebäude, Vorgänge, Förderfälle, Kommunikation und Belege an einem Ort – API-first, selbst gehostet.

> Status: in Entwicklung. Siehe [Konzept](docs/konzept.md).

## Schnellstart

Voraussetzungen: Node.js ≥ 22.12, pnpm 10, Postgres 16.

```bash
pnpm install
cp .env.example .env            # DATABASE_URL und API_TOKEN anpassen
cd apps/api
pnpm db:migrate
pnpm dev                        # http://localhost:3000
```

- `GET /health` – Lebenszeichen
- `GET /openapi.json` – vollständige API-Beschreibung (OpenAPI 3.1)
- `/api/v1/*` – API, Authentifizierung per `Authorization: Bearer <API_TOKEN>`
- `/mcp` – MCP-Server (Streamable HTTP, gleiches Token). Jede API-Operation ist automatisch ein Tool.

### MCP-Client anbinden

```json
{
  "mcpServers": {
    "objektakte": {
      "type": "http",
      "url": "https://objektakte.example.org/mcp",
      "headers": { "Authorization": "Bearer <API_TOKEN>" }
    }
  }
}
```

Mit Docker: `POSTGRES_PASSWORD=… API_TOKEN=… WEB_PASSWORD=… WEB_SESSION_SECRET=… WEB_ORIGIN=… docker compose up -d`.

### Web-Oberfläche

Büro-Oberfläche und offline-fähige Begehungs-App unter `apps/web` (SvelteKit), siehe [docs/web.md](docs/web.md):

```bash
cd apps/web
API_URL=http://localhost:3000 API_TOKEN=… WEB_PASSWORD=… WEB_SESSION_SECRET=… pnpm dev
```

## Entwicklung

```bash
pnpm lint          # Biome (Lint + Format-Check)
pnpm format        # Biome mit Auto-Fix
pnpm typecheck
pnpm test          # benötigt TEST_DATABASE_URL (Default: lokale DB objektakte_test)
```

Schemaänderungen: `apps/api/src/db/schema.ts` anpassen, dann `pnpm --filter @objektakte/api db:generate` und die erzeugte Migration einchecken.

## Dokumentation

- [Konzept und Architektur](docs/konzept.md)
- [Import-Format](docs/import-format.md)
- [Fristen und Förderfälle](docs/fristen.md)
- [Ereignisse und Webhooks](docs/webhooks.md)
- [Kommunikation und Zuordnung](docs/kommunikation.md)
- [Begehung vor Ort](docs/begehung.md)
- [Zahlungen und Export](docs/zahlungen.md)
- [Angebote, Rechnungen und E-Rechnung](docs/rechnungen.md)
- [Verfahrensdokumentation (Muster)](docs/verfahrensdokumentation.md)
- [Web-Oberfläche und PWA „Vor Ort“](docs/web.md)

## Lizenz

[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Wer objektakte verändert und als Netzwerkdienst anbietet, muss den Nutzern den Quelltext der geänderten Fassung zugänglich machen.
