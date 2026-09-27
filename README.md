# SunkenBot

SunkenBot is a Bun-powered Messenger bot. This repository now includes resilient image commands backed by the Betadash API catalog.

## Betadash API catalog findings

The live `/docs` page is a client-rendered catalog, not an OpenAPI document. The documented image endpoints use **GET** requests and query parameters, and return image bytes when successful. No API key, bearer token, or rate-limit quota is documented. A probe on 27 September 2026 confirmed `GET /brat?text=hello` returns `image/png`; documented slap routes may return HTTP 500 for invalid or unsupported IDs.

Supported command mappings:

| Command | Endpoint | Request shape | Success response |
|---|---|---|---|
| `canva` profile designs | `GET /brick-wall`, `/city-billboard`, `/night-city`, `/wanted-poster`, `/rainbow`, `/beautiful`, `/calendar` | `?userid=<5–20 digit UID>` | image bytes, usually `image/png` |
| `canva brat` / `brat` | `GET /brat` | `?text=<up to 180 chars>` | `image/png` |
| `slap` | `GET /slapv2` | `?one=<UID>&two=<UID>` | image bytes; may fail upstream |
| `slap` fallback | `GET /slap` or `/spank` | `?batman=<UID>&superman=<UID>` or `?uid1=<UID>&uid2=<UID>` | image bytes; may fail upstream |
| `rankup` | `GET /api/rankup` | `?uid=<UID>` | profile-overlay image/GIF when available |

Authentication is **not documented**. The client sends no credential by default and supports an optional `BETADASH_API_KEY` only if the provider later documents bearer authentication. Rate limits are also **not documented**; the bot therefore applies a conservative local limit (`BETADASH_RATE_LIMIT`, default 8 requests per 10 seconds), honors `Retry-After`, and retries transient failures with capped exponential backoff.

## Usage

- `canva` — generate a profile design for yourself.
- `canva @person` or reply to a message — generate that member's design.
- `canva city-billboard @person` — choose a design explicitly.
- `canva brat hello world` — generate a text canvas.
- `canva list` — show supported designs.
- `slap @person` or reply to a message — generate an interaction canvas.
- `slap slapv2 @person` — choose the first endpoint explicitly.
- `slap list` — show the available interaction endpoints.
- `brat <text>` — generate a text canvas directly.
- `rankup` or `rankup @person` — generate a rank-up card.

## Reliability and cost controls

Image responses are validated as bounded image payloads before delivery. Identical requests share an in-flight promise and are cached in memory for 10 minutes. Endpoint candidates have bounded retries, jittered exponential backoff, `Retry-After` support, and graceful Arabic fallback messages. Temporary files are removed in `finally` blocks. Requests use compact query parameters and never send an LLM request.

The cache is process-local. For a multi-instance deployment, use a shared cache only if traffic requires it; the current Render service runs one instance and does not need the added cost or operational complexity.

## Testing

```sh
bun test test/
```

The test suite covers validation, payload hardening, argument parsing, and existing persistence/provider behavior.

## Environment variables

- `BETADASH_API_BASE` — optional override for the API base URL.
- `BETADASH_API_KEY` — optional bearer credential, only when supplied by the API owner.
- `BETADASH_RATE_LIMIT` — local request budget per 10-second window; default `8`.

Never commit `APPSTATE`, API keys, or other secrets. Render environment variables should be managed in the Render dashboard or secret environment configuration.
