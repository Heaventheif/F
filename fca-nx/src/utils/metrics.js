"use strict";
/**
 * metrics.js — Lightweight observability bus
 * ───────────────────────────────────────────
 * Drop-in for fca-nx/src/utils/metrics.js
 *
 * WHAT IT DOES:
 *   - Maintains in-process counters for every meaningful bot event
 *   - Emits an EventEmitter "bump" event on every counter change
 *     (hook this for external alerting / Prometheus / Grafana)
 *   - Logs a JSON summary every 5 minutes (configurable)
 *   - Exposes a snapshot() for the /health endpoint
 *
 * WIRE-IN — call bump() from the relevant modules:
 *
 *   // MqttConnectionManager.js — _reconnect():
 *   require("./metrics").bump("reconnects");
 *
 *   // MqttConnectionManager.js — _recordEvent():
 *   require("./metrics").bump("eventsReceived");
 *
 *   // MqttConnectionManager.js — auth_failed handler:
 *   require("./metrics").bump("authEvents");
 *
 *   // safeSend.js — on successful send:
 *   require("./metrics").bump("sends");
 *
 *   // safeSend.js — in catch block:
 *   require("./metrics").bump("sendErrors");
 *
 *   // rateLimiter.js — when throttle() delays:
 *   require("./metrics").bump("rateLimitedWaits");
 *
 *   // session-extender.js — _doKeepAlive success:
 *   require("./metrics").bump("keepAlives");
 *
 *   // session-extender.js — _scheduleWarmer success:
 *   require("./metrics").bump("warmers");
 *
 *   // session-extender.js — _refreshSession success:
 *   require("./metrics").bump("extensions");
 */

const { EventEmitter } = require("events");

// ── Counters ──────────────────────────────────────────────────────────────────

const _counters = {
  // MQTT
  reconnects:        0,
  eventsReceived:    0,
  authEvents:        0,       // AUTH_FAILED / login_blocked occurrences

  // Messaging
  sends:             0,
  sendErrors:        0,
  prioritySends:     0,

  // Rate limiting
  rateLimitedWaits:  0,       // times throttle() had to wait

  // Session health
  keepAlives:        0,       // successful 18h keep-alive pings
  warmers:           0,       // successful 3–5h session warmers
  extensions:        0,       // successful SessionExtender refreshes
  appStateSaves:     0,       // successful encrypted file writes

  // Errors
  watchdogFires:     0,       // watchdog-triggered reconnects
  circuitOpens:      0,       // SessionExtender circuit-breaker activations
};

const _startTime = Date.now();

// ── EventEmitter ──────────────────────────────────────────────────────────────

const emitter = new EventEmitter();
emitter.setMaxListeners(32);

// ── Core bump() ───────────────────────────────────────────────────────────────

/**
 * Increment a named counter and emit a "bump" event.
 * @param {string} key   Counter name (must exist in _counters)
 * @param {number} [n=1] Amount to add
 * @returns {number}     New counter value
 */
function bump(key, n = 1) {
  if (!(key in _counters)) {
    // Allow unknown keys but warn once so rogue callers are visible
    _counters[key] = 0;
    console.warn(`[metrics] Unknown counter key: "${key}" — added dynamically`);
  }
  _counters[key] += n;
  emitter.emit("bump", key, _counters[key]);
  return _counters[key];
}

/**
 * Read a counter value without mutating it.
 * @param {string} key
 * @returns {number}
 */
function get(key) {
  return _counters[key] ?? 0;
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

/**
 * Return a full metrics snapshot — safe to serialise to JSON.
 * Includes MQTT health, memory, and uptime from the running bot.
 * @returns {object}
 */
function snapshot() {
  const mqttHealth = global._mqttHealthByBot?.get(1) ?? {};
  const mem        = process.memoryUsage();
  const uptimeSec  = Math.round((Date.now() - _startTime) / 1_000);

  return {
    ts:                new Date().toISOString(),
    uptime_s:          uptimeSec,
    ...Object.fromEntries(Object.entries(_counters)),
    // MQTT state from MqttConnectionManager.health()
    mqtt_state:        mqttHealth.state        ?? "unknown",
    mqtt_ok:           mqttHealth.ok           ?? false,
    mqtt_reconnects:   mqttHealth.totalReconnects ?? 0,
    mqtt_events:       mqttHealth.eventsReceived  ?? 0,
    mqtt_consec_errs:  mqttHealth.consecutiveErrors ?? 0,
    mqtt_last_err:     mqttHealth.lastError    ?? null,
    // Memory
    mem_rss_mb:        +(mem.rss        / 1_048_576).toFixed(1),
    mem_heap_mb:       +(mem.heapUsed   / 1_048_576).toFixed(1),
    mem_heap_total_mb: +(mem.heapTotal  / 1_048_576).toFixed(1),
    // Session extender stats (if available)
    session_extender:  global.botApi?._sessionExtender?.getStats?.() ?? null,
  };
}

// ── Periodic log ──────────────────────────────────────────────────────────────

const LOG_INTERVAL_MS = (() => {
  const min = parseInt(process.env.METRICS_LOG_INTERVAL_MIN ?? "5", 10);
  return (isNaN(min) || min < 1 ? 5 : min) * 60_000;
})();

const _logTimer = setInterval(() => {
  try {
    const snap = snapshot();
    console.log(`[METRICS] ${JSON.stringify(snap)}`);
    emitter.emit("snapshot", snap);
  } catch (err) {
    console.warn("[metrics] snapshot error:", err.message);
  }
}, LOG_INTERVAL_MS);

_logTimer.unref?.();   // don't block process exit

// ── Reset (for testing) ───────────────────────────────────────────────────────

function reset() {
  for (const k of Object.keys(_counters)) _counters[k] = 0;
}

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = {
  bump,
  get,
  snapshot,
  reset,
  emitter,
  counters: _counters,   // direct reference for tests — do not mutate externally
};
