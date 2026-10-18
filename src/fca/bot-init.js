"use strict";
import { createRequire } from "node:module";
import { createMqttConnectionManager } from "./MqttConnectionManager.js";
const require = createRequire(import.meta.url);
let _createSessionExtender = null;
try {
  _createSessionExtender = (await import("./session-extender.js").catch((e) => {
    console.warn("[EXTENDER:load] فشل تحميل session-extender.js — تمديد الجلسة معطّل:", e?.stack ?? e?.message ?? e);
    return null;
  }))?.createSessionExtender ?? null;
} catch (e) { console.warn("[EXTENDER:load]", e?.message ?? e); }
export async function startMqttListener(api, { label, botIndex, onEvent }) {
  if (api.__mqttManager) return api.__mqttManager.reconnect("duplicate_start");
  const acceptedThreads = api._acceptedThreads || (api._acceptedThreads = new Set());
  const manager = createMqttConnectionManager(api, {
    label,
    botIndex,
    onState: (health) => { api.__mqttHealth = health; },
    onEvent: (event) => {
      try { onEvent?.(event, api, acceptedThreads); }
      catch (err) { console.error(`[EVENT:${label}]`, err.message); }
    },
  });
  api.__mqttManager = manager;
  api.__mqttHealth  = manager.health();
  manager.on("auth_failed", (h) =>
    console.error(`[MQTT:${label}] 🔒 AppState محجوب:`, h.lastError || "auth_failed"));
  manager.on("cooldown", (h) =>
    console.warn(`[MQTT:${label}] ⏳ cooldown حتى ${h.cooldownUntil}`));
  manager.start();
  console.log(`[SUCCESS] ${label} مدير MQTT نشط`);
  return manager;
}
export async function initBotLifecycle(api, botIndex, opts = {}) {
  const {
    saveAppState    = () => {},
    onMqttEvent     = () => {},
    onFirstBotReady = () => {},
  } = opts;
  const label = `Bot-${botIndex}`;
  api.__lifecycleStopped = false;
  api.__stopSessionLifecycle = async () => {
    if (api.__lifecycleStopped) return;
    api.__lifecycleStopped = true;
    clearTimeout(api.__appStateSaveTimer);
    try { api._sessionExtender?.stop(); } catch (_) {}
    try { await api.__mqttManager?.stop(); } catch (_) {}
  };
  try {
    api.setOptions({
      listenEvents:   true,
      updatePresence: false,
      autoReconnect:  true,
      autoMarkRead:   true,
      listenTyping:   false,
    });
  } catch (e) { console.warn(`[LOGIN:${label}] setOptions فشل:`, e?.message ?? e); }
  console.log(`[LOGIN:${label}] ✅ الاتصال بفيسبوك مستقر`);
  global.botApis.push(api);
  api.__botIndex = botIndex;
  global.botApi  = api;
  if (typeof _createSessionExtender === "function") {
    try {
      const extender = _createSessionExtender({
        api,
        botIndex,
        refreshThresholdMs: 14 * 24 * 60 * 60 * 1_000,
        onAppStateSave: (s) => saveAppState(s, botIndex, "keep-alive"),
        onExtended:     ({ count }) => console.log(`[EXTENDER:${label}] 📦 تمديد #${count}`),
      });
      extender.start();
      api._sessionExtender = extender;
    } catch (e) {
      console.warn(`[EXTENDER:${label}] ⚠️`, e.message);
    }
  }
  const freshState = api.getAppState?.();
  if (freshState?.length) {
    saveAppState(freshState, botIndex, "post-login");
    global.appState = freshState;
  }
  ;(function scheduleAppStateSave() {
    const delay = (60 + Math.random() * 60) * 60_000;
    api.__appStateSaveTimer = setTimeout(() => {
      try {
        const s = api.getAppState?.();
        if (s?.length) {
          saveAppState(s, botIndex, "scheduled");
          global.appState = s;
        }
      } catch (e) { console.warn(`[APPSTATE:${label}] الحفظ الدوري فشل:`, e?.message ?? e); }
      if (!api.__lifecycleStopped) scheduleAppStateSave();
    }, delay);
    api.__appStateSaveTimer.unref?.();
  })();
  await startMqttListener(api, { label, botIndex, onEvent: onMqttEvent });
  onFirstBotReady();
}
