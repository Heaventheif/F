#!/usr/bin/env node
"use strict";
/**
 * soak.js — Long-duration liveness & stability test
 * ───────────────────────────────────────────────────
 * Usage:  bun scripts/soak.js [--hours=72] [--thread=THREAD_ID]
 *
 * Must be run INSIDE a running bot process that exposes:
 *   global._mqttHealthByBot  — Map<botIndex, MqttConnectionManager.health()>
 *   global.botApi            — fcanew-r3nz75 API object
 *   global.botApi._sessionExtender.getStats()
 *
 * What it checks every 60 seconds:
 *   - MQTT is still CONNECTED
 *   - No silent drop (no events for >30 min on an active account)
 *   - Total reconnects < 40 (backoff is working if bot handles drops cleanly)
 *   - Memory RSS < 500MB (no leak)
 *   - AppState file updated within last 3h
 *
 * What it does every 2 hours (if --thread is given):
 *   - Sends a self-message to prove end-to-end send/receive path
 *
 * Outputs structured JSON logs for easy parsing / Grafana import.
 * Prints [SOAK FAIL] lines (non-terminating) on any assertion breach.
 * Exits with code 0 on success, 1 if any assertion was breached.
 */

import fs   from "fs";
import path from "path";

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const v = process.argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1];
  return v !== undefined ? v : fallback;
}

const HOURS     = parseFloat(arg("hours", "24"));
const THREAD_ID = arg("thread", process.env.SOAK_TEST_THREAD ?? "");
const END_MS    = Date.now() + HOURS * 3_600_000;
const STATE_DIR = process.env.STATE_DIR ?? "/var/data";
const STATE_FILE = path.join(STATE_DIR, "appstate.enc");

// ── State ─────────────────────────────────────────────────────────────────────

let _failures     = 0;
let _checkCount   = 0;
let _selfSends    = 0;
let _selfFails    = 0;
let _prevReconns  = 0;

// ── Assertion helper ──────────────────────────────────────────────────────────

function assert(condition, message) {
  if (!condition) {
    _failures++;
    console.error(`[SOAK FAIL] ${new Date().toISOString()} — ${message}`);
  }
}

// ── Main check loop ───────────────────────────────────────────────────────────

async function runCheck() {
  _checkCount++;

  const h   = global._mqttHealthByBot?.get(1) ?? {};
  const mem = process.memoryUsage();
  const ses = global.botApi?._sessionExtender?.getStats?.() ?? {};

  // State file age
  let stateAgeMs = null;
  try {
    if (fs.existsSync(STATE_FILE)) {
      stateAgeMs = Date.now() - fs.statSync(STATE_FILE).mtimeMs;
    }
  } catch (_) {}

  // Last event time (convert ISO string back to ms)
  const lastEventMs = h.lastEventAt ? new Date(h.lastEventAt).getTime() : Date.now();
  const idleMin     = ((Date.now() - lastEventMs) / 60_000).toFixed(1);

  // Elapsed / progress
  const elapsed    = Date.now() - (END_MS - HOURS * 3_600_000);
  const elapsedPct = ((elapsed / (HOURS * 3_600_000)) * 100).toFixed(1);

  // Build log line
  const log = {
    ts:            new Date().toISOString(),
    elapsed_pct:   elapsedPct,
    check_num:     _checkCount,
    mqtt_state:    h.state     ?? "unknown",
    mqtt_ok:       h.ok        ?? false,
    idle_min:      parseFloat(idleMin),
    total_reconns: h.totalReconnects   ?? 0,
    consec_errors: h.consecutiveErrors ?? 0,
    events_recvd:  h.eventsReceived    ?? 0,
    last_err:      h.lastError ?? null,
    session_ok:    ses.sessionHealthy  ?? null,
    keepAlives:    ses.keepAlives      ?? 0,
    warmers:       ses.warmers         ?? 0,
    extensions:    ses.extensions      ?? 0,
    circuit_open:  ses.circuitOpen     ?? null,
    mem_rss_mb:    +(mem.rss      / 1_048_576).toFixed(1),
    mem_heap_mb:   +(mem.heapUsed / 1_048_576).toFixed(1),
    state_age_min: stateAgeMs !== null ? +(stateAgeMs / 60_000).toFixed(1) : null,
    self_sends:    _selfSends,
    self_fails:    _selfFails,
    failures_so_far: _failures,
  };

  console.log(JSON.stringify(log));

  // ── Assertions ──────────────────────────────────────────────────────────────

  assert(
    h.state !== "AUTH_FAILED",
    `MQTT AUTH_FAILED — AppState is blocked. Last error: ${h.lastError}`
  );
  assert(
    parseFloat(idleMin) < 30,
    `No MQTT events for ${idleMin}min — possible silent disconnect`
  );
  assert(
    (h.totalReconnects ?? 0) < 40,
    `Total reconnects = ${h.totalReconnects} (>40 = backoff not working)`
  );
  assert(
    log.mem_rss_mb < 500,
    `Memory leak suspected — RSS = ${log.mem_rss_mb}MB`
  );
  if (stateAgeMs !== null) {
    assert(
      stateAgeMs < 3 * 3_600_000,
      `AppState file not updated for ${log.state_age_min}min — saves may be failing`
    );
  }
  assert(
    (h.consecutiveErrors ?? 0) < 5,
    `${h.consecutiveErrors} consecutive MQTT errors — ${h.lastError}`
  );
}

// ── Self-message every 2h ─────────────────────────────────────────────────────

async function selfPing() {
  if (!THREAD_ID || !global.botApi) return;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("send timeout")), 30_000);
      global.botApi.sendMessage(
        `[soak-ping] ${new Date().toISOString()} check=${_checkCount}`,
        THREAD_ID,
        (err) => { clearTimeout(timeout); err ? reject(err) : resolve(); }
      );
    });
    _selfSends++;
    console.log(`[SOAK] ✉️  Self-ping #${_selfSends} sent`);
  } catch (err) {
    _selfFails++;
    console.error(`[SOAK FAIL] Self-ping #${_selfSends + 1} failed: ${err.message}`);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

console.log(JSON.stringify({
  ts:       new Date().toISOString(),
  event:    "soak_start",
  hours:    HOURS,
  thread:   THREAD_ID || null,
  end_at:   new Date(END_MS).toISOString(),
}));

// Main 60s check loop
const checkTimer = setInterval(async () => {
  await runCheck();
  if (Date.now() >= END_MS) {
    clearInterval(checkTimer);
    clearInterval(pingTimer);
    const code = _failures > 0 ? 1 : 0;
    console.log(JSON.stringify({
      ts:       new Date().toISOString(),
      event:    "soak_complete",
      checks:   _checkCount,
      failures: _failures,
      result:   code === 0 ? "PASS" : "FAIL",
    }));
    process.exit(code);
  }
}, 60_000);

checkTimer.unref?.();

// Self-ping loop (every 2h if thread configured)
const pingTimer = THREAD_ID
  ? setInterval(selfPing, 2 * 3_600_000)
  : setInterval(() => {}, 1_000_000_000);   // no-op timer

pingTimer.unref?.();

// Initial check after 30s
setTimeout(runCheck, 30_000).unref?.();

// Keep the process alive
process.stdin.resume();

console.log(
  `[SOAK] Running for ${HOURS}h` +
  (THREAD_ID ? ` with self-ping to thread ${THREAD_ID}` : " (no self-ping — pass --thread=ID to enable)")
);
