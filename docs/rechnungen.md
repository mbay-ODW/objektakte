# Angebote, Rechnungen und E-Rechnung

## Belegarten

| Art | Nummernkreis (Standard) | E-Rechnung |
|---|---|---|
| Angebot | `ANG-{YYYY}-{N}` | – |
| Auftragsbestätigung | `AB-{YYYY}-{N}` | – |
| Rechnung, Abschlags-, Schluss-, Storno­rechnung, Gutschrift | gemeinsamer Kreis `RE-{YYYY}-{N}` | ZUGFeRD oder XRechnung |
| Zahlungserinnerung/Mahnung | `ZE-{YYYY}-{N}` | – |

Muster und Startwerte: `PUT /api/v1/settings/company` (`numberPatterns`) bzw. `PUT /api/v1/number-sequences/beleg:rechnung` (z. B. um einen bestehenden Nummernkreis fortzusetzen; nur Erhöhen möglich).

## Ablauf

1. **Entwurf** anlegen: `POST /api/v1/billing-documents` (Positionen frei oder aus dem Artikelstamm `PUT /api/v1/articles/{code}`).
2. **Prüfen**: `GET …/{id}/check` (Summen und fehlende Pflichtangaben) und `GET …/{id}/preview` (PDF mit Vermerk „Entwurf“).
3. **Festschreiben**: `POST …/{id}/finalize`
   - erzeugt E-Rechnung und PDF/A-3 zunächst mit einer Prüfnummer und lässt sie vom Validator prüfen – ohne den Nummernkreis zu sperren,
   - vergibt danach in einer kurzen Transaktion die Nummer (lückenlos), erzeugt den Beleg endgültig (identischer Inhalt, nur Nummer/Zahlungsreferenz) und legt die Dateien ab,
   - speichert einen SHA-256-Inhaltsnachweis.
   Wurden Entwurf oder Firmendaten während der Prüfung geändert, bricht das Festschreiben ab. Scheitert ein Schritt, wird alles zurückgerollt – auch die Nummer – und bereits abgelegte Dateien werden wieder entfernt. Ist der Validator nicht erreichbar, antwortet die API mit 503.
4. **Versand** vermerken: `POST …/{id}/sent`.
5. **Folgebelege**: `…/convert` (z. B. Angebot → Rechnung), `…/cancel` (Stornorechnung), `…/reminder` (Zahlungserinnerung/Mahnung für offene Rechnungen).

## E-Rechnung

Beide Formate entstehen aus einem gemeinsamen Rechnungsmodell nach EN 16931 (UN/CEFACT CII):

- **ZUGFeRD / Factur-X, Profil EN 16931** – PDF/A-3b mit eingebetteter `factur-x.xml`. Standard für Unternehmen und Privatkunden.
- **XRechnung 3.0 (CII)** – reine XML-Datei für öffentliche Auftraggeber, zusätzlich ein PDF zur Ansicht. Wird automatisch gewählt, wenn beim Kontakt eine **Leitweg-ID** hinterlegt ist (BT-10).

Pflichtangaben, die vor dem Festschreiben geprüft werden (Auszug): Firmendaten mit USt-IdNr. oder Steuernummer, für XRechnung zusätzlich Ansprechpartner, Telefon, E-Mail, IBAN, Leitweg-ID und die E-Mail-Adresse des Auftraggebers (elektronische Adresse, BT-49).

Sonderfälle:
- **Kleinunternehmer (§ 19 UStG)**: `smallBusiness: true` – Positionen werden steuerfrei (Kategorie E) mit Pflichthinweis, auch bei Entwürfen, die vor dem Umschalten angelegt wurden; da keine USt-IdNr. vorliegt, ist eine Verkäuferkennung (`sellerId`, BT-29) nötig.
- **Reverse Charge (§ 13b UStG)**: Kategorie AE mit USt-IdNr. beider Parteien.
- **Schlussrechnung**: bereits festgeschriebene Abschlagsrechnungen desselben Vorgangs werden automatisch abgesetzt – je Abschlag mit Entgelt und Umsatzsteuer (§ 14 Abs. 5 UStG) im PDF und in der E-Rechnung (BT-113, Hinweistext). Offene Posten, Mahnungen, Umsatz und DATEV rechnen mit dem Betrag nach Abzug. Ein abgezogener Abschlag kann erst storniert werden, wenn die Schlussrechnung storniert ist.
- **Steuerbefreiung/nicht steuerbar**: Befreiungsgründe je Kategorie über `exemptionReasons` (z. B. `{ "E": "Steuerfrei nach § 4 Nr. … UStG" }`); nicht steuerbare Positionen (O) dürfen nicht mit anderen Kategorien gemischt werden.
- **Storno**: Stornorechnung (Typ 381) mit Bezug auf die ursprüngliche Rechnung (BT-25); die Originalrechnung erhält den Status „storniert“.

### Validator

Die Prüfung übernimmt der Dienst in [`/validator`](../validator/README.md) (Mustang: EN 16931, XRechnung, ZUGFeRD, PDF/A-3 per veraPDF). In CI werden alle Rechnungsarten gegen diesen Validator geprüft. Einstellung `EINVOICE_VALIDATION=required` (Standard) verhindert das Festschreiben ohne bestandene Prüfung.

## Eingangsrechnungen

`POST /api/v1/incoming-invoices` nimmt XRechnung (CII oder UBL) und ZUGFeRD/Factur-X-PDFs entgegen, liest Nummer, Datum, Lieferant, Beträge, Fälligkeit und IBAN aus und legt die Originaldatei in der Ablage ab (Duplikaterkennung über SHA-256). Status: offen → geprüft → bezahlt / abgelehnt.
