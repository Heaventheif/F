# FCA integration

This directory contains the bot's integration boundary for `fcanew-r3nz75`.

## Responsibilities

- `Client.js`: AppState loading, FCA login options, and lifecycle bootstrap.
- `bot-init.js`: post-login initialization and one MQTT listener per API instance.
- `MqttConnectionManager.js`: the single owner of `listenMqtt`, liveness checks, reconnect backoff, and auth-failure cooldowns.
- `session-extender.js`: conservative AppState health checks and optional, explicitly enabled keep-alive checks. It never fabricates cookie expiry dates.
- `appStatePersist.js`: encrypted, atomic AppState persistence and merge-on-save.
- `runtimeEnv.js`: secure AppState environment parsing.
- `rateLimiter.js`: shared request pacing utilities for FCA-compatible HTTP wrappers.
- `watchdog.js`: deprecated compatibility export; new code must use `MqttConnectionManager` instead.
- `fca-config.json`: package-level FCA configuration reference.

## Reliability boundary

`fcanew-r3nz75` owns Facebook transport and its supported reconnect behavior. The bot adds bounded command concurrency, conservative per-thread send pacing, encrypted persistence, and observability. It does not spoof devices, rotate user agents, simulate activity, or attempt to bypass platform enforcement.

Keep credentials in Render environment variables or the encrypted AppState file; never commit them here.

The administrative command `ban ungroup` is allowed through the banned-group gate only for a configured developer. It clears the in-memory set and the connected ban database record; `ban ungroup <GID>` can target another group.
