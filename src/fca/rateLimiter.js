"use strict";
/**
 * rateLimiter.js — URL-classified token-bucket rate limiter
 * ───────────────────────────────────────────────────────────
 * Drop-in for fcanew-r3nz75/src/utils/rateLimiter.js
 *
 * PROBLEM:
 *   Every command module in src/cmds/ can fire GraphQL calls unbounded.
 *   Parallel command handlers can pile up requests faster than a real
 *   browser ever would. Facebook's anomaly detection flags this within
 *   minutes on busy bots.
 *
 * SOLUTION:
 *   A shared token-bucket per endpoint *category* — different categories
 *   have different rates because FB monitors them independently:
 *     - graphql   : /api/graphql, /graphqlbatch  → most sensitive
 *     - mercury   : legacy AJAX endpoints         → also sensitive
 *     - upload    : file upload endpoint           → slowest
 *     - default   : everything else
 *
 * WIRE-IN (one line per wrapper in methods.js):
 *   const { throttle } = require("../rateLimiter");
 *
 *   async function get(url, ...) {
 *     await throttle(url);   // ← add this
 *     ...
 *   }
 *   async function post(url, ...) {
 *     await throttle(url);   // ← add this
 *     ...
 *   }
 *
 * CONFIG (read from global.fca?.config?.limits or environment):
 *   FCA_RATE_GRAPHQL   — tokens/second for GraphQL  (default 0.5)
 *   FCA_RATE_MERCURY   — tokens/second for Mercury   (default 0.2)
 *   FCA_RATE_UPLOAD    — tokens/second for uploads   (default 0.1)
 *   FCA_RATE_DEFAULT   — tokens/second for default   (default 1.0)
 */

const { EventEmitter } = require("events");

// ── Token Bucket ──────────────────────────────────────────────────────────────

class TokenBucket {
  /**
   * @param {number} rate   Tokens refilled per second (sustained throughput)
   * @param {number} burst  Maximum token capacity (burst allowance)
   */
  constructor(rate, burst) {
    this.rate   = rate;
    this.burst  = burst;
    this.tokens = burst;       // start full
    this.last   = Date.now();
  }

  /**
   * Attempt to consume one token immediately.
   * @returns {boolean} true if token was available and consumed
   */
  take() {
    const now = Date.now();
    // Refill based on elapsed time
    this.tokens = Math.min(
      this.burst,
      this.tokens + ((now - this.last) / 1_000) * this.rate
    );
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** How many ms until at least one token is available */
  msUntilReady() {
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.rate * 1_000);
  }
}

// ── Rate categories ───────────────────────────────────────────────────────────

function _envNum(key, fallback) {
  const v = parseFloat(process.env[key]);
  return isNaN(v) ? fallback : v;
}

const buckets = {
  graphql: new TokenBucket(_envNum("FCA_RATE_GRAPHQL", 0.5), 3),   // ~1 call/2s, burst 3
  mercury: new TokenBucket(_envNum("FCA_RATE_MERCURY", 0.2), 2),   // legacy endpoints
  upload:  new TokenBucket(_envNum("FCA_RATE_UPLOAD",  0.1), 1),   // uploads: very slow
  default: new TokenBucket(_envNum("FCA_RATE_DEFAULT", 1.0), 5),   // general: 1/s, burst 5
};

function _classify(url) {
  if (!url) return "default";
  if (/graphqlbatch|\/api\/graphql/.test(url))           return "graphql";
  if (/mercury|ajax\/friends|ajax\/profile/.test(url))   return "mercury";
  if (/upload\.php/.test(url))                           return "upload";
  return "default";
}

// ── Metrics hook ──────────────────────────────────────────────────────────────

const emitter = new EventEmitter();
let _totalWaits = 0;
let _totalWaitMs = 0;

// ── Core throttle function ────────────────────────────────────────────────────

/**
 * Await this before any HTTP call to enforce rate limits.
 * Returns immediately when a token is available; otherwise polls with
 * human-ish jitter (150–550ms) to avoid a tight busy-loop.
 *
 * @param {string} url  The request URL — used to classify the rate category
 * @returns {Promise<void>}
 */
function throttle(url) {
  const category = _classify(url);
  const bucket   = buckets[category];

  if (bucket.take()) return Promise.resolve();   // fast path: token available

  // Slow path: wait until a token is ready, then retry
  return new Promise((resolve) => {
    const startWait = Date.now();

    function tryTake() {
      if (bucket.take()) {
        const waited = Date.now() - startWait;
        _totalWaits++;
        _totalWaitMs += waited;
        emitter.emit("throttled", { category, waitedMs: waited, url });
        // Lazy import so metrics.js is optional
        try { require("./metrics").bump("rateLimitedWaits"); } catch (_) {}
        return resolve();
      }
      // Poll at 150–550ms — not a tight loop, adds slight human-like variance
      const ms = 150 + Math.floor(Math.random() * 400);
      setTimeout(tryTake, ms);
    }

    tryTake();
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function stats() {
  return {
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([k, b]) => [
        k, { tokens: +b.tokens.toFixed(2), rate: b.rate, burst: b.burst }
      ])
    ),
    totalWaits:   _totalWaits,
    totalWaitMs:  _totalWaitMs,
    avgWaitMs:    _totalWaits ? Math.round(_totalWaitMs / _totalWaits) : 0,
  };
}

/**
 * Reconfigure rates at runtime (e.g. when a 429 is received).
 * @param {string} category  "graphql" | "mercury" | "upload" | "default"
 * @param {number} rate      New tokens/second
 * @param {number} [burst]   New burst size (defaults to current)
 */
function reconfigure(category, rate, burst) {
  const b = buckets[category];
  if (!b) throw new Error(`Unknown rate category: ${category}`);
  b.rate  = rate;
  if (burst !== undefined) b.burst = burst;
  // Clamp current tokens to new burst
  b.tokens = Math.min(b.tokens, b.burst);
}

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = {
  throttle,
  buckets,
  stats,
  reconfigure,
  emitter,
  TokenBucket,
  _classify,        // exported for tests
};
