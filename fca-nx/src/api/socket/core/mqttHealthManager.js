"use strict";

/**
 * Lightweight MQTT health/watchdog manager.
 *
 * Reconnection itself remains owned by listenMqtt/connectMqtt. This manager
 * only observes the current transport, exposes health metrics, and asks the
 * existing reconnect path to cycle a stale socket. Keeping one reconnect
 * owner prevents duplicate sockets and competing backoff timers.
 */
class MqttHealthManager {
  constructor(options = {}) {
    this.ctx = options.ctx || {};
    this.getClient = typeof options.getClient === "function"
      ? options.getClient
      : () => this.ctx.mqttClient;
    this.reconnect = typeof options.reconnect === "function"
      ? options.reconnect
      : () => {};
    this.logger = typeof options.logger === "function" ? options.logger : () => {};
    this.staleAfterMs = options.staleAfterMs === undefined
      ? 8 * 60 * 1000
      : Math.max(0, Number(options.staleAfterMs) || 0);
    this.initialGraceMs = options.initialGraceMs === undefined
      ? 2 * 60 * 1000
      : Math.max(0, Number(options.initialGraceMs) || 0);
    this.watchdogIntervalMs = options.watchdogIntervalMs === undefined
      ? 30 * 1000
      : Math.max(1, Number(options.watchdogIntervalMs) || 1);
    this.running = false;
    this.state = "STOPPED";
    this.startedAt = 0;
    this.connectedSince = 0;
    this.lastActivityAt = 0;
    this.lastDisconnectAt = 0;
    this.lastReconnectReason = null;
    this.eventsReceived = 0;
    this.lastEventType = null;
    this.watchdogTimer = null;
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.startedAt = Date.now();
    this.connectedSince = Date.now();
    this.lastActivityAt = Date.now();
    this.state = "CONNECTING";
    this._scheduleWatchdog();
    return this;
  }

  stop() {
    this.running = false;
    this.state = "STOPPED";
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    return this;
  }

  markConnected() {
    const now = Date.now();
    if (!this.connectedSince) this.connectedSince = now;
    this.lastActivityAt = now;
    this.state = "CONNECTING";
    return this;
  }

  markActivity(type = "packet") {
    this.lastActivityAt = Date.now();
    this.lastEventType = type;
    this.eventsReceived++;
    if (this.getClient()?.connected) this.state = "CONNECTED";
    return this;
  }

  markDisconnected(reason) {
    this.lastDisconnectAt = Date.now();
    if (reason) this.lastReconnectReason = String(reason);
    if (this.running) this.state = "DEGRADED";
    return this;
  }

  health() {
    const now = Date.now();
    const client = this.getClient();
    const socketConnected = client?.connected === true;
    const lastActivityAt = Math.max(this.lastActivityAt, this.connectedSince);
    const staleForMs = lastActivityAt ? Math.max(0, now - lastActivityAt) : null;
    const stableForMs = this.connectedSince ? Math.max(0, now - this.connectedSince) : 0;

    return {
      ok: this.running && socketConnected && this.state === "CONNECTED" &&
        staleForMs !== null && staleForMs < this.staleAfterMs,
      state: this.state,
      socketConnected,
      staleForMs,
      stableForMs,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      connectedSince: this.connectedSince ? new Date(this.connectedSince).toISOString() : null,
      lastActivityAt: this.lastActivityAt ? new Date(this.lastActivityAt).toISOString() : null,
      lastDisconnectAt: this.lastDisconnectAt ? new Date(this.lastDisconnectAt).toISOString() : null,
      lastReconnectReason: this.lastReconnectReason,
      reconnectAttempts: Number(this.ctx._reconnectAttempts) || 0,
      reconnectScheduled: Boolean(this.ctx._reconnectTimer),
      eventsReceived: this.eventsReceived,
      lastEventType: this.lastEventType
    };
  }

  _scheduleWatchdog() {
    if (!this.running) return;
    this.watchdogTimer = setTimeout(() => {
      this._watchdog();
      this._scheduleWatchdog();
    }, this.watchdogIntervalMs);
    if (this.watchdogTimer.unref) this.watchdogTimer.unref();
  }

  _watchdog() {
    if (!this.running || this.ctx._ending) return;
    const client = this.getClient();
    if (!client?.connected) {
      this.state = "CONNECTING";
      return;
    }

    const now = Date.now();
    const inGracePeriod = this.connectedSince &&
      now - this.connectedSince < this.initialGraceMs;
    const stale = this.lastActivityAt &&
      now - this.lastActivityAt >= this.staleAfterMs;

    if (inGracePeriod || !stale || this.ctx._cycling || this.ctx._reconnectTimer) return;

    this.state = "DEGRADED";
    this.lastReconnectReason = "watchdog_stale";
    this.logger("mqtt health watchdog detected a stale socket; using the existing reconnect path", "warn");
    try {
      this.reconnect("watchdog_stale");
    } catch (error) {
      this.logger(`mqtt health watchdog reconnect error: ${error.message || error}`, "error");
    }
  }
}

module.exports = MqttHealthManager;