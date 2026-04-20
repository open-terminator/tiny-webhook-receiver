<div align="center">

# tiny-webhook-receiver

A tiny dependency-free webhook receiver in Node.js.

![Node](https://img.shields.io/badge/runtime-node-339933)
![Dependencies](https://img.shields.io/badge/dependencies-0-2ea44f)
![Storage](https://img.shields.io/badge/storage-json_files-blue)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

## Overview

`tiny-webhook-receiver` is a minimal HTTP server for receiving GitHub-style webhooks without frameworks or external dependencies.

It accepts JSON webhook deliveries, optionally verifies `sha256=` HMAC signatures, and stores accepted payloads as JSON files on disk.

## Run

```bash
npm start
```

By default the server listens on `0.0.0.0:3000`.

## Configuration

Environment variables:

- `PORT` sets the listening port, default `3000`
- `HOST` sets the bind address, default `0.0.0.0`
- `WEBHOOK_SECRET` enables GitHub-style `x-hub-signature-256` verification

If `WEBHOOK_SECRET` is not set, `POST /webhook` accepts unsigned requests.

## Endpoints

### `GET /health`
Returns a simple health response.

### `GET /deliveries`
Returns saved deliveries from `data/*.json`, newest first.

Optional query parameters:

- `event=push` filters by exact event name
- `deliveryId=<id>` filters by exact delivery ID
- `verified=true|false` filters by signature verification status
- `limit=<n>` returns only the first `n` matching deliveries

Each item includes:

- `fileName`
- `receivedAt`
- `deliveryId`
- `event`
- `signatureVerified`

### `GET /deliveries/<deliveryId>`
Returns one saved delivery by exact delivery ID, including the stored `payload`.

If no saved delivery matches, the endpoint returns `404`.

### `POST /webhook`
Accepts a JSON payload and writes accepted deliveries to `data/*.json`.

When `WEBHOOK_SECRET` is configured:
- missing or invalid signatures return `401`
- valid signatures are marked as verified in the saved delivery

Invalid JSON returns `400`.

## Examples

Health check:

```bash
curl -s http://127.0.0.1:3000/health
```

List saved deliveries:

```bash
curl -s http://127.0.0.1:3000/deliveries
```

Fetch one saved delivery:

```bash
curl -s http://127.0.0.1:3000/deliveries/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

Filter saved deliveries:

```bash
curl -s 'http://127.0.0.1:3000/deliveries?event=push&verified=true&limit=5'
```

Example deliveries response:

```json
{
  "ok": true,
  "filters": {
    "event": null,
    "deliveryId": null,
    "verified": null,
    "limit": null
  },
  "total": 1,
  "deliveries": [
    {
      "fileName": "2026-04-18T10-20-30-000Z_f47ac10b-58cc-4372-a567-0e02b2c3d479.json",
      "receivedAt": "2026-04-18T10:20:30.000Z",
      "deliveryId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "event": "push",
      "signatureVerified": true
    }
  ]
}
```

Example delivery detail response:

```json
{
  "ok": true,
  "delivery": {
    "fileName": "2026-04-18T10-20-30-000Z_f47ac10b-58cc-4372-a567-0e02b2c3d479.json",
    "receivedAt": "2026-04-18T10:20:30.000Z",
    "deliveryId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "event": "push",
    "signatureVerified": true,
    "payload": {
      "action": "ping"
    }
  }
}
```

Unsigned webhook:

```bash
curl -s \
  -X POST http://127.0.0.1:3000/webhook \
  -H 'Content-Type: application/json' \
  -d '{"hello":"world"}'
```

Signed webhook:

```bash
export WEBHOOK_SECRET='topsecret'
payload='{"action":"ping"}'
signature=$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.* //')

curl -s \
  -X POST http://127.0.0.1:3000/webhook \
  -H 'Content-Type: application/json' \
  -H "x-hub-signature-256: sha256=$signature" \
  -d "$payload"
```

Example success response:

```json
{
  "ok": true,
  "savedAs": "2026-04-18T10-20-30-000Z_f47ac10b-58cc-4372-a567-0e02b2c3d479.json",
  "signatureVerified": true
}
```

## Stored deliveries

Each accepted delivery contains:

- `receivedAt`
- `deliveryId`
- `event`
- `signatureVerified`
- `payload`

## Notes

- accepted deliveries are stored under `data/`
- persisted JSON files are ignored by git
- unknown routes return `404`

## License

MIT
