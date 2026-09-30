# E-Rechnungs-Validator

Kleiner HTTP-Dienst um die [Mustang](https://www.mustangproject.org/)-Bibliothek (Apache-2.0). Prüft
- XRechnung (CII) gegen EN 16931 und die XRechnung-Regeln,
- ZUGFeRD/Factur-X-PDFs inklusive PDF/A-3-Konformität (veraPDF) und eingebetteter XML.

```bash
docker build -t objektakte-validator validator
docker run -p 8080:8080 objektakte-validator
curl --data-binary @rechnung.pdf http://localhost:8080/validate   # Header X-Validation-Status: valid|invalid
```

Ohne Docker (Java 21): `java -cp Mustang-CLI-2.26.0.jar validator/Server.java` (JAR von Maven Central).

objektakte ruft den Dienst beim Festschreiben jeder Rechnung auf (`EINVOICE_VALIDATOR_URL`). Mit `EINVOICE_VALIDATION=required` (Standard) wird ohne bestandene Prüfung nicht festgeschrieben.
