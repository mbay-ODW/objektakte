# Ereignisse und Webhooks

Jede fachliche Änderung schreibt in derselben Transaktion ein Ereignis in das append-only-Protokoll (`events`). Es lässt sich auf zwei Wegen konsumieren:

## Polling

`GET /api/v1/events?after=<id>&types=case.created,deadline.created` liefert Ereignisse nach einer ID (Cursor).

## Webhooks

`POST /api/v1/webhooks` mit `url` und `eventTypes` (`*`, `case.*`, `deadline.created` …). Die Antwort enthält einmalig das `secret`.

Zustellung:
- `POST` an die URL mit `{ subscriptionId, events: [...] }` (bis zu 100 Ereignisse je Aufruf)
- Header `X-Objektakte-Signature: sha256=<HMAC-SHA256(secret, body)>` und `X-Objektakte-Delivery: <letzte Ereignis-ID>`
- **mindestens einmal**: Der Cursor rückt erst nach einer 2xx-Antwort vor. Empfänger deduplizieren über `events[].id`.
- Bei Fehlern exponentieller Backoff (15 s … 1 h). `PATCH /api/v1/webhooks/{id}` mit `resetFailures: true` setzt zurück.
- Neue Abonnements starten beim aktuellen Stand; `replay: true` stellt die gesamte Historie zu.

Signatur prüfen (Node.js):

```js
const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-objektakte-signature"]));
```
