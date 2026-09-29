# Verfahrensdokumentation (Muster)

Diese Beschreibung dokumentiert, wie objektakte Belege erzeugt, festschreibt und aufbewahrt. Sie ist als **Vorlage** für die eigene Verfahrensdokumentation nach GoBD gedacht und muss um betriebsindividuelle Angaben (Verantwortliche, Hosting, Datensicherung, Zugriffsrechte) ergänzt werden.

## 1. Belegentstehung

- Belege werden als Entwurf erfasst. Entwürfe haben keine Nummer und können geändert oder gelöscht werden.
- Beim Festschreiben wird die nächste Nummer des jeweiligen Nummernkreises innerhalb einer Datenbanktransaktion mit Zeilensperre vergeben. Schlägt ein Schritt fehl, wird die gesamte Transaktion zurückgerollt; der Nummernkreis bleibt lückenlos.
- Rechnungsartige Belege (Rechnung, Abschlags-, Schluss-, Stornorechnung, Gutschrift) teilen einen Nummernkreis.

## 2. Unveränderbarkeit

- Festgeschriebene eigene Belege und ihre Positionen können weder geändert noch gelöscht werden. Dies wird durch Datenbank-Trigger erzwungen, unabhängig von der Anwendung.
- Zulässig sind ausschließlich der Versandvermerk sowie die Statusfolge *festgeschrieben → versendet → storniert*.
- Korrekturen erfolgen durch Stornorechnung mit Bezug auf den ursprünglichen Beleg und ggf. einen neuen Beleg.
- Beim Festschreiben wird ein SHA-256-Hash über den kanonischen Rechnungsinhalt, das PDF und die XML gespeichert; außerdem Momentaufnahmen der Verkäufer- und Käuferdaten.

## 3. Protokollierung

- Jede fachliche Änderung (Anlage, Änderung, Festschreiben, Versand, Storno, Zahlungszuordnung) wird im Ereignisprotokoll mit Zeitpunkt und Akteur gespeichert.
- Das Ereignisprotokoll ist append-only; UPDATE, DELETE und TRUNCATE werden durch Trigger verhindert.

## 4. E-Rechnung

- Rechnungen werden als ZUGFeRD/Factur-X (PDF/A-3 mit eingebetteter XML, EN 16931) oder XRechnung 3.0 erzeugt. Maßgeblich ist der strukturierte Teil (XML).
- Vor dem Festschreiben wird die E-Rechnung durch einen Validator geprüft (EN 16931, XRechnung, PDF/A). Das Prüfergebnis wird am Beleg gespeichert.
- Empfangene E-Rechnungen werden unverändert im Original abgelegt und ausgelesen.

## 5. Aufbewahrung

- PDF- und XML-Dateien werden in der Dateiablage (z. B. Nextcloud) abgelegt, die Datenbank speichert Pfad und SHA-256.
- Aufbewahrungsfristen (derzeit 8 Jahre für Buchungsbelege, 10 Jahre für Bücher und Aufzeichnungen) sind über die Datensicherung der Datenbank und der Dateiablage sicherzustellen. Eine unveränderbare (WORM-)Sicherung wird empfohlen.

## 6. Schnittstellen

- Übergabe an die Buchhaltung per DATEV-Buchungsstapel (EXTF) und Monatspaket (siehe [Zahlungen und Export](zahlungen.md)).
- Import von Altdaten erfolgt als Archivkopie (`source = import`); diese Belege werden nicht erneut festgeschrieben.

## 7. Betriebsindividuelle Ergänzungen

- Verantwortliche Person(en):
- Betrieb/Hosting, Zugriffsschutz:
- Datensicherung (Verfahren, Intervall, Wiederherstellungstest):
- Änderungshistorie dieser Dokumentation:
