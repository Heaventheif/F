class Watchdog {
  constructor(options = {}) {
    this._api = options.api;
    this._log = options.logger ?? (() => {});
    this._onSilence = options.onSilence ?? (() => {});
    this._silenceMs = options.silenceMs ?? 5 * 60 * 1000;
    this._checkIntervalMs = options.checkIntervalMs ?? 60 * 1000;
    this._lastHeartbeat = Date.now();
    this._checkTimer = null;
    this._destroyed = false;
    this._silenceTriggered = false;
  }
  heartbeat() { this._lastHeartbeat = Date.now(); this._silenceTriggered = false; }
  start() {
    if (this._destroyed) return this;
    this._scheduleCheck();
    this._log("Watchdog: started", "info");
    return this;
  }
  stop() {
    this._destroyed = true;
    if (this._checkTimer) clearTimeout(this._checkTimer);
    this._checkTimer = null;
    this._log("Watchdog: stopped", "info");
  }
  _scheduleCheck() {
    if (this._destroyed) return;
    this._checkTimer = setTimeout(() => {
      this._checkTimer = null;
      const silentFor = Date.now() - this._lastHeartbeat;
      if (silentFor >= this._silenceMs && !this._silenceTriggered) {
        this._silenceTriggered = true;
        this._log(`Watchdog: no MQTT event for ${Math.round(silentFor / 60000)}min — triggering reconnect`, "warn");
        try { this._onSilence(silentFor); } catch (_) {}
      }
      this._scheduleCheck();
    }, this._checkIntervalMs);
    this._checkTimer.unref?.();
  }
}

export { Watchdog };
