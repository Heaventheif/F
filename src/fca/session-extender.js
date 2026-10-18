"use strict";
import { checkAppStateExpiry } from "./appStatePersist.js";
const HEALTH_CHECK_NORMAL_MS  = 20 * 60 * 1_000;
const HEALTH_CHECK_RELAXED_MS = 45 * 60 * 1_000;
const HEALTH_CHECK_URGENT_MS  = 10 * 60 * 1_000;
const REFRESH_THRESHOLD_MS    = 14 * 24 * 60 * 60 * 1_000;
const KEEP_ALIVE_INTERVAL_MS  = 18 * 60 * 60 * 1_000;
const MAX_CONSECUTIVE_FAILS   = 5;
const CIRCUIT_BREAKER_MS      = 45 * 60 * 1_000;
const KEEPALIVE_ENDPOINT      = "https://www.facebook.com/messages/";
const _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class SessionExtender {
  constructor(opts = {}) {
    this._api            = opts.api;
    this._label          = `Bot-${opts.botIndex ?? 1}`;
    this._onExtended     = typeof opts.onExtended     === "function" ? opts.onExtended     : null;
    this._onAppStateSave = typeof opts.onAppStateSave === "function" ? opts.onAppStateSave : null;
    this._threshold      = opts.refreshThresholdMs  ?? REFRESH_THRESHOLD_MS;
    this._keepAliveMs    = opts.keepAliveIntervalMs ?? KEEP_ALIVE_INTERVAL_MS;
    this._healthTimer    = null;
    this._keepAliveTimer = null;
    this._running        = false;
    this._extensions = 0;
    this._keepAlives = 0;
    this._consecutiveFails = 0;
    this._circuitOpen      = false;
    this._circuitOpenUntil = 0;
    this._sessionHealthy   = true;
    this._lastHealthStatus = null;
  }
  start() {
    if (this._running) return this;
    this._running = true;
    setTimeout(() => {
      if (this._running) this._doHealthCheck(true).catch(() => {});
    }, 30_000);
    this._scheduleHealthCheck();
    this._scheduleKeepAlive();
    const kaEnabled = this._keepAliveEnabled();
    console.log(
      `[EXTENDER:${this._label}] ▶️ SessionExtender نشط — ` +
      `keep-alive: ${kaEnabled ? `كل ${Math.round(this._keepAliveMs / 3_600_000)} ساعة` : "معطّل (FCA_ENABLE_KEEPALIVE=true لتفعيله)"}` +
      ` | عتبة التجديد: ${Math.round(this._threshold / 86_400_000)} يوم`
    );
    return this;
  }
  stop() {
    this._running = false;
    clearTimeout(this._healthTimer);    this._healthTimer    = null;
    clearTimeout(this._keepAliveTimer); this._keepAliveTimer = null;
    console.log(`[EXTENDER:${this._label}] ⏹️ SessionExtender متوقف`);
    return this;
  }
  _scheduleHealthCheck() {
    if (!this._running) return;
    let interval;
    if (!this._sessionHealthy || this._circuitOpen) interval = HEALTH_CHECK_URGENT_MS;
    else if (this._lastHealthStatus?.expiring)      interval = HEALTH_CHECK_NORMAL_MS;
    else                                            interval = HEALTH_CHECK_RELAXED_MS;
    const jitter = (Math.random() * 0.3 - 0.15) * interval;
    const delay  = Math.max(60_000, Math.round(interval + jitter));
    this._healthTimer = setTimeout(() => {
      this._doHealthCheck(false).finally(() => this._scheduleHealthCheck());
    }, delay);
    this._healthTimer?.unref?.();
  }
  _scheduleKeepAlive() {
    if (!this._running || !this._keepAliveEnabled()) return;
    const delay = this._keepAlives === 0
      ? 60 * 60 * 1_000
      : this._keepAliveMs + (Math.random() * 40 - 20) * 60_000;
    this._keepAliveTimer = setTimeout(() => {
      this._doKeepAlive().finally(() => this._scheduleKeepAlive());
    }, delay);
    this._keepAliveTimer?.unref?.();
  }
  async _doHealthCheck(lightweight = false) {
    const label = this._label;
    const now   = Date.now();
    if (this._circuitOpen && now < this._circuitOpenUntil) {
      const remaining = Math.round((this._circuitOpenUntil - now) / 60_000);
      console.log(`[EXTENDER:${label}] ⚡ Circuit breaker مفتوح — ${remaining} دقيقة متبقية`);
      return;
    }
    if (this._circuitOpen) {
      this._circuitOpen      = false;
      this._consecutiveFails = 0;
      console.log(`[EXTENDER:${label}] ✅ Circuit breaker أُغلق — إعادة المحاولة`);
    }
    try {
      let currentState = null;
      try { currentState = this._api?.getAppState?.(); } catch (_) {}
      if (!currentState?.length) {
        console.warn(`[EXTENDER:${label}] ⚠️ لا يمكن قراءة AppState`);
        this._recordFail();
        return;
      }
      const expiryStatus = checkAppStateExpiry(currentState, this._threshold);
      this._lastHealthStatus = expiryStatus;
      const { expiring, critical, minTtlMs, expiresAt, expiringSoon } = expiryStatus;
      if (!lightweight) {
        const daysLeft = isFinite(minTtlMs) ? (minTtlMs / 86_400_000).toFixed(1) : "∞";
        console.log(
          `[EXTENDER:${label}] 🩺 فحص الجلسة — ` +
          `${isFinite(minTtlMs) ? `تنتهي خلال ${daysLeft} يوم` : "كوكيز دائمة"}` +
          (expiringSoon.length ? ` ⚠️ ${expiringSoon.join(", ")}` : "")
        );
      }
      if (critical) {
        console.error(`[EXTENDER:${label}] 🚨 حالة حرجة! تجديد فوري...`);
        this._sessionHealthy = false;
        await this._refreshSession(expiresAt, true);
      } else if (expiring) {
        await this._refreshSession(expiresAt, false);
      }
      await this._refreshFbDtsg();
      this._sessionHealthy   = true;
      this._consecutiveFails = 0;
    } catch (err) {
      this._recordFail(err.message);
    }
  }
  async _doKeepAlive() {
    if (!this._keepAliveEnabled()) return;
    const label = this._label;
    const ctx   = (this._api?.ctx ?? this._api?._ctx);
    const fns   = (this._api?.defaultFuncs ?? this._api?._defaultFuncs);
    if (!ctx || !fns?.get) return;
    try {
      await _sleep(3_000 + Math.random() * 5_000);
      await fns.get(KEEPALIVE_ENDPOINT, ctx.jar, {}, {
        noRef:               false,
        _skipSessionInspect: true,
      });
      this._keepAlives++;
      console.log(`[EXTENDER:${label}] 💓 keep-alive #${this._keepAlives}`);
      await this._saveCurrentAppState("keep-alive");
    } catch (e) {
      console.warn(`[EXTENDER:${label}] ⚠️ keep-alive فشل: ${e.message}`);
    }
  }
  async _refreshSession(expiresAt, isCritical) {
    const label   = this._label;
    const urgency = isCritical ? "🔴 حرج" : "🟡 وقائي";
    const when    = expiresAt ? `(تنتهي: ${expiresAt.toISOString()})` : "";
    console.log(`[EXTENDER:${label}] 🔄 تجديد [${urgency}] ${when}...`);
    await this._internalWarmup(isCritical);
    const freshState = this._api?.getAppState?.();
    if (freshState?.length) {
      this._extensions++;
      this._sessionHealthy = true;
    }
    console.log(`[EXTENDER:${label}] ✅ تجديد #${this._extensions} — الجلسة مُمدَّدة`);
    this._onExtended?.({ count: this._extensions, critical: isCritical });
    await this._saveCurrentAppState("session-refresh");
  }
  async _refreshFbDtsg() {
    try {
      if (typeof this._api?.refreshFb_dtsg === "function") await this._api.refreshFb_dtsg();
    } catch (_) {  }
  }
  async _internalWarmup(aggressive = false) {
    const ctx = (this._api?.ctx ?? this._api?._ctx);
    const fns = (this._api?.defaultFuncs ?? this._api?._defaultFuncs);
    if (!ctx || !fns?.get) return;
    const endpoints = aggressive
      ? [KEEPALIVE_ENDPOINT, "https://www.facebook.com/", KEEPALIVE_ENDPOINT]
      : [KEEPALIVE_ENDPOINT];
    for (const ep of endpoints) {
      try {
        await _sleep(1_500 + Math.random() * 2_500);
        await fns.get(ep, ctx.jar, {});
      } catch (_) {}
    }
  }
  async _saveCurrentAppState(reason = "auto") {
    try {
      const state = this._api?.getAppState?.();
      if (!state?.length) return;
      if (this._onAppStateSave) this._onAppStateSave(state);
      else console.warn(`[EXTENDER:${this._label}] ⚠️ onAppStateSave غير مُمرَّر (${reason})`);
    } catch (e) {
      console.warn(`[EXTENDER:${this._label}] ⚠️ فشل حفظ AppState (${reason}): ${e.message}`);
    }
  }
  _recordFail(errMsg = "unknown") {
    this._consecutiveFails++;
    console.warn(`[EXTENDER:${this._label}] ❌ فشل (${this._consecutiveFails}/${MAX_CONSECUTIVE_FAILS}): ${errMsg}`);
    if (this._consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
      this._circuitOpen      = true;
      this._circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_MS;
      this._consecutiveFails = 0;
      this._sessionHealthy   = false;
      console.error(
        `[EXTENDER:${this._label}] 🔌 Circuit breaker فُتح — ` +
        `توقف ${Math.round(CIRCUIT_BREAKER_MS / 60_000)} دقيقة ثم إعادة المحاولة`
      );
    }
  }
  _keepAliveEnabled() {
    return String(process.env.FCA_ENABLE_KEEPALIVE || "").toLowerCase() === "true";
  }
}
export function createSessionExtender(opts) {
  return new SessionExtender(opts);
}
export default SessionExtender;
