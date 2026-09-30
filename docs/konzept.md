# Konzept

objektakte ist eine Fallakte für Energieberatung. Im Mittelpunkt steht das **Gebäude** (Objekt), nicht das einzelne Projekt: Ein Objekt durchläuft über Jahre mehrere Vorgänge – etwa Sanierungsfahrplan, Einzelmaßnahme mit Förderantrag und Verwendungsnachweis –, und an ihm hängen wechselnde Beteiligte (Eigentümer, Verwaltung, Handwerker, Planer).

Zielgruppe: kleine Energieberatungsbüros (Wohn- und Nichtwohngebäude), die mit wenig Personal viele geförderte Vorgänge parallel betreuen.

## Leitgedanken

1. **Objekt als Anker.** Kunde → Objekt → Vorgänge. Personen hängen mit einer Rolle am Objekt.
2. **Förderfall als eigene Fachlichkeit.** Programm, Richtlinienstand, Antrags-/Nachweis-IDs, Bewilligungszeitraum, Boni. Fristen werden aus Regeln berechnet; die Regeln sind Daten.
3. **Abgeleiteter Status.** Der Status eines Vorgangs ergibt sich aus Fakten (Angebot angenommen, Rechnung versendet, Zahlung eingegangen). Manuelles Überschreiben ist möglich und wird markiert.
4. **Keine eigene Dateiablage.** Dateien bleiben in der vorhandenen Ablage (z. B. Nextcloud, Paperless). objektakte speichert Referenzen und Klassifikation.
5. **Kommunikation als strukturierte Daten.** E-Mail, Messenger, Telefon und Vor-Ort-Notizen bilden eine Timeline je Kontakt, Objekt und Vorgang. Nicht eindeutig zuordenbare Nachrichten landen in einer Zuordnungs-Inbox.
6. **API zuerst, auch für KI-Assistenten.** REST/OpenAPI als einzige Schnittstelle; ein MCP-Server wird aus derselben Spezifikation erzeugt. Kein GraphQL.
7. **Ereignisse nativ.** Jede Änderung landet in einem append-only-Ereignisprotokoll; Webhooks werden daraus per Outbox verteilt.
8. **Dokumente aus Daten.** Angebote, Protokolle und Fachkonzepte werden aus Vorlagen und Domänendaten erzeugt (PDF-Rendering über Gotenberg).
9. **Rechnungsstellung GoBD-konform mit E-Rechnung von Anfang an** (siehe unten).
10. **Vor-Ort-Begehung als offline-fähige Web-App** mit Fotos, Messwerten und Sprachnotizen (Transkription über einen selbst gehosteten Whisper-Dienst).

## Architektur

```
Quellen: E-Mail · Messenger · Bank · Dokumentenablage · Dateiablage
            │  (Adapter / Automatisierung, z. B. n8n)
            ▼
┌──────────── objektakte (modularer Monolith) ───────────────────────┐
│ Module: contacts · objects · cases · funding · deadlines · comms    │
│         documents(ref) · inspections · billing · payments           │
│ API: REST/OpenAPI  ──►  MCP-Server (gleiches Repo)                  │
│ UI: Büro-Oberfläche + PWA „Vor Ort“ (offline)                       │
│ Sidecars: Whisper · Gotenberg · E-Rechnungs-Validator (Mustang)     │
│ events (append-only) ──► outbox ──► Webhooks                        │
└───────────────┬─────────────────────────────────────────────────────┘
                ▼
        Postgres (+pgvector)   ·   Dateiablage (Referenzen)
```

- **Stack:** TypeScript, Hono + `@hono/zod-openapi`, Drizzle ORM, Postgres 16. UI: SvelteKit (Büro und PWA in einer App).
- **Warum keine Graph-Datenbank:** Die Beziehungen Person–Objekt–Vorgang–Förderfall–Dokument–Nachricht sind klar relational. Postgres mit Verknüpfungstabellen und rekursiven Abfragen reicht; semantische Suche über `pgvector`. Eine Beziehungs*ansicht* in der UI wird aus denselben Tabellen erzeugt.
- **Auth:** zunächst Bearer-Token, danach OIDC.

## Rechnungsstellung

Im Nichtwohngebäude-Kontext (Kommunen, Unternehmen) ist die E-Rechnung Pflicht. Sie ist deshalb Kernbestandteil, keine Ausbaustufe.

- **Belegarten:** Angebot, Auftragsbestätigung, Abschlags-/Teil-/Schlussrechnung, Stornorechnung, Gutschrift, Zahlungserinnerung.
- **GoBD:** Entwurf → *Festschreiben*. Danach unveränderlich (Hash über Inhalt, PDF und XML im Ereignisprotokoll). Korrektur nur per Storno/Gutschrift. Lückenlose Nummernkreise, vergeben beim Festschreiben. Verfahrensdokumentation im Repo.
- **E-Rechnung:** kanonisches Rechnungsmodell nach EN 16931, daraus
  - **XRechnung** (CII/UBL) für öffentliche Auftraggeber mit Leitweg-ID,
  - **ZUGFeRD/Factur-X** (Profil EN16931) als PDF/A-3 mit eingebettetem XML.
  Das PDF/A-3 wird direkt in der Anwendung erzeugt (eingebettete Schriften, ICC-Profil, XMP-Metadaten), damit Aufbau und Konformität vollständig testbar sind. Validierung **vor** dem Festschreiben durch den Mustang-Validator (EN 16931, XRechnung, PDF/A-3 per veraPDF); ungültige Rechnungen lassen sich nicht festschreiben.
- **Eingangsrechnungen:** strukturierte E-Rechnungen werden geparst (XML vor PDF-Text).
- **Export:** DATEV-Buchungsstapel und Beleg-Archiv je Monat für die Steuerberatung.
- **Bankabgleich:** Kontoumsätze werden gegen offene Posten gematcht; „bezahlt“ ist ein Faktum, kein Häkchen.

## Vor-Ort-Begehung

- Begehung = Termin am Objekt mit Teilnehmern, Zeitraum und Standort; nach Abschluss festgeschrieben.
- Erfassung je Bauteil/Raum/Anlage (bei Nichtwohngebäuden zusätzlich Zonen/Nutzungen) mit Fotos, Notizen, Messwerten, Mängeln.
- Sprachnotizen hängen am Bauteil bzw. Foto, werden transkribiert und optional in strukturierte Feldvorschläge überführt, die bestätigt werden müssen.
- Offline-first: Service Worker + IndexedDB-Warteschlange, Synchronisation bei Verbindung.
- Ergebnis: Begehungsprotokoll als PDF, Timeline-Eintrag, Vorbefüllung für Fachberichte.

## Ausbaustufen

| Phase | Inhalt | Stand |
|---|---|---|
| 0 | Grundgerüst, Datenmodell, neutrale Import-Schnittstelle, CI | umgesetzt |
| 1 | Förderfall, Fristen-Engine, MCP-Server, Webhooks | umgesetzt |
| 2 | Kommunikations-Timeline mit automatischer Zuordnung und Zuordnungs-Inbox | umgesetzt |
| 3 | Begehung (API + offline-fähige PWA mit Sprachnotizen), Büro-Oberfläche | umgesetzt |
| 4 | Bankabgleich, Offene Posten, abgeleiteter Status, Auswertungen, DATEV-Export | umgesetzt |
| 5 | Rechnungsstellung mit E-Rechnung (XRechnung/ZUGFeRD), GoBD-Festschreibung, Mahnwesen, Eingangsrechnungen | umgesetzt |

Bewusst noch offen: strukturierte Feldvorschläge aus Sprachnotizen per KI, Versand von Belegen direkt aus der Anwendung (derzeit über Download bzw. Webhook an einen Mail-Workflow), Peppol-Versand, OIDC-Anmeldung.
