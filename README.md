# objektakte

Fallakte für Energieberatung: Kontakte, Gebäude, Vorgänge, Förderfälle, Kommunikation und Belege an einem Ort – API-first, selbst gehostet.

> Status: **Phase 0** – Datenmodell, Import-Schnittstelle, Lese-API. Siehe [Konzept](docs/konzept.md).

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

Mit Docker: `POSTGRES_PASSWORD=… API_TOKEN=… docker compose up -d`.

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
