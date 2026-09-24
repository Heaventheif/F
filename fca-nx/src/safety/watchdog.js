"use strict";
/**
 * watchdog.js — Silent-drop detection + fb_dtsg refresh
 * Source: fca-unofficial lib/safety/watchdog.js (adapted to CJS)
 */
class Watchdog {
  constructor(options = {}) {
    this._ctx = options.ctx;
    this._api = options.api;
    this._log = options.logger ?? (() => {});
    this._onSilence = options.onSilence ?? (() => {});
    this._silenceMs = options.silenceMs ?? 5 * 60 * 1000;
    this._checkIntervalMs = options.checkIntervalMs ?? 60 * 1000;
    this._dtsgIntervalMs = options.dtsgIntervalMs ?? (3 * 60 * 60 * 1000 + Math.random() * 30 * 60 * 1000);
    this._maxDtsgFailures = options.maxDtsgFailures ?? 3;
    this._lastHeartbeat = Date.now();
    this._checkTimer = null;
    this._dtsgTimer = null;
    this._dtsgFailures = 0;
    this._silenceTriggered = false;
    this._destroyed = false;
  }

  heartbeat() { this._lastHeartbeat = Date.now(); this._silenceTriggered = false; }

  start() {
    if (this._destroyed) return this;
    this._scheduleCheck();
    this._scheduleDtsgRefresh();
    this._log("Watchdog: started", "info");
    return this;
  }

  stop() {
    this._destroyed = true;
    if (this._checkTimer) { clearTimeout(this._checkTimer); this._checkTimer = null; }
    if (this._dtsgTimer)  { clearTimeout(this._dtsgTimer);  this._dtsgTimer  = null; }
    this._log("Watchdog: stopped", "info");
  }

  _scheduleCheck() {
    if (this._destroyed) return;
    this._checkTimer = setTimeout(() => {
      this._checkTimer = null;
      this._runSilenceCheck();
      if (!this._destroyed) this._scheduleCheck();
    }, this._checkIntervalMs);
    if (this._checkTimer.unref) this._checkTimer.unref();
  }

  _runSilenceCheck() {
    const silentFor = Date.now() - this._lastHeartbeat;
    if (silentFor >= this._silenceMs && !this._silenceTriggered) {
      this._silenceTriggered = true;
      const mins = Math.round(silentFor / 60000);
      this._log(`Watchdog: no MQTT event for ${mins}min — triggering reconnect`, "warn");
      try { require("../utils/metrics").bump("watchdogFires"); } catch (_) {}
      try { this._onSilence(silentFor); } catch (_) {}
    }
  }

  _scheduleDtsgRefresh() {
    if (this._destroyed) return;
    const delay = this._dtsgIntervalMs + (Math.random() - 0.5) * 10 * 60 * 1000;
    this._dtsgTimer = setTimeout(async () => {
      this._dtsgTimer = null;
      await this._refreshDtsg();
      if (!this._destroyed) this._scheduleDtsgRefresh();
    }, delay);
    if (this._dtsgTimer.unref) this._dtsgTimer.unref();
  }

  async _refreshDtsg() {
    try {
      const fns = this._api?._defaultFuncs;
      const ctx = this._api?._ctx;
      if (!fns?.get || !ctx) return;
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
      const res = await fns.get("https://www.facebook.com/", ctx.jar, {}, { _skipSessionInspect: true });
      const html = String(res?.data || res?.body || "");
      const dtsg = html.match(/DTSGInitialData.*?"token"\s*:\s*"([^"]+)"/)?.[1]
                ?? html.match(/"dtsg"\s*:\s*\{"token"\s*:\s*"([^"]+)"/)?.[1];
      if (dtsg && ctx.fb_dtsg !== dtsg) {
        ctx.fb_dtsg = dtsg;
        ctx.jazoest = null;
        this._log("Watchdog: fb_dtsg refreshed", "info");
      }
      this._dtsgFailures = 0;
    } catch (err) {
      this._dtsgFailures++;
      this._log(`Watchdog: fb_dtsg refresh failed (${this._dtsgFailures}/${this._maxDtsgFailures}): ${err.message}`, "warn");
    }
  }
}

module.exports = { Watchdog };
