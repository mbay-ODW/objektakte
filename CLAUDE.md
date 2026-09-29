# objektakte – Hinweise für Claude

Öffentliches Repository. Fallakte für Energieberatung (TypeScript, Hono, Drizzle, Postgres).

## Harte Regeln
- **Keine Herkunfts- oder Anbieterbezüge:** Namen kommerzieller Branchen-/Handwerkersoftware, von denen Daten übernommen werden, erscheinen nirgends – weder in Code, Kommentaren, Doku, Commit-Messages, Branch-Namen noch Issues. Quellsysteme heißen neutral „Quellsystem“ bzw. werden über `source` im Import benannt.
- **Keine echten Personen- oder Kundendaten**, auch nicht in Tests/Fixtures (nur synthetische Daten wie „Max Muster“, `example.org`). Keine Secrets, keine internen Hostnamen.
- Quellsystem-Adapter gehören nicht in dieses Repo; sie sprechen nur `POST /api/v1/import`.
- Belege (Rechnungen) sind GoBD-relevant: festgeschriebene Belege nie verändern, Korrektur nur per Storno. Das Ereignisprotokoll (`events`) ist append-only.

## Arbeitsweise
- Befehle: `pnpm lint`, `pnpm typecheck`, `pnpm test` (braucht Postgres, siehe README), `pnpm build`.
- Schemaänderung → `pnpm --filter @objektakte/api db:generate`, Migration einchecken; CI prüft, dass Schema und Migrationen übereinstimmen.
- Jede fachliche Schreiboperation schreibt in derselben Transaktion ein Ereignis (`recordEvents`).
- API-Routen immer mit `createRoute` + Zod-Schemas, damit OpenAPI (und der daraus erzeugte MCP-Server) vollständig bleibt.
- Domänenbegriffe und Enum-Werte auf Deutsch (Fachsprache), Code-Bezeichner auf Englisch.
