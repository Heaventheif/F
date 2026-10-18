"use strict";
import path from "path";
import { createRequire }  from "node:module";
import { fileURLToPath }  from "node:url";
const require = createRequire(import.meta.url);
const fcaNx   = require("./fcanew");
const login   = fcaNx.login ?? fcaNx.default ?? fcaNx;
import { readAppStateFromEnv, updateAppStateInMemory } from "./runtimeEnv.js";
import { dispatchMqttEvent }    from "../events/onMessage.js";
import { startCleanupInterval } from "../events/onReady.js";
import { initBotLifecycle }    from "./bot-init.js";
import { persistAppState, readPersistedAppState } from "./appStatePersist.js";
import { startMonitoring } from "../core/monitor.js";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.join(MODULE_DIR, "..", "..");
export function loadAppState() {
  let state = readAppStateFromEnv();
  if (state) return { state, index: 1, source: "APPSTATE" };
  try {
    const fromFile = readPersistedAppState();
    if (Array.isArray(fromFile) && fromFile.length) {
      console.warn("[APPSTATE] ⚠️ استعادة من الملف المشفَّر (البيئة فارغة)");
      return { state: fromFile, index: 1, source: "encrypted-file" };
    }
  } catch (e) { console.warn("[APPSTATE] تعذّرت قراءة الملف المشفَّر:", e?.message ?? e); }
  return null;
}
export function saveAppStateForBot(state, botIndex = 1, source = "runtime") {
  try {
    if (!Array.isArray(state) || state.length === 0) throw new Error("فارغ");
    const keys = new Set(state.map(c => String(c?.key ?? c?.name ?? "")));
    if (!keys.has("c_user") || !keys.has("xs")) throw new Error("cookies ناقصة");
    updateAppStateInMemory(state);
    persistAppState(state, source);
    console.log(`[APPSTATE] ✅ حُفظ (${state.length} cookie | Bot-${botIndex} | ${source})`);
    return true;
  } catch (err) {
    console.warn(`[APPSTATE] ⚠️ ${err.message}`);
    return false;
  }
}
const GLOBAL_OPTIONS = {
  selfListen:     false,
  listenEvents:   true,
  forceLogin:     false,
  autoMarkRead:   true,
  updatePresence: false,
  autoReconnect:  true,
  online:         true,
};
export function loginBot(account) {
  const { state, index } = account;
  const label = `Bot-${index}`;
  console.log(`[LOGIN:${label}] 🔑 تسجيل الدخول بـ AppState...`);
  return new Promise((resolve, reject) => {
    login({ appState: state }, GLOBAL_OPTIONS, async (err, api) => {
      if (err) {
        const msg = err?.error || err?.message || String(err);
        console.error(`[LOGIN:${label}] ❌ فشل: ${msg}`);
        if (/checkpoint/i.test(msg))
          console.log(`[2FA:${label}] ⚡ أعد إنشاء APPSTATE من متصفح موثوق`);
        return reject(new Error(msg));
      }
      console.log(`[LOGIN:${label}] ✅ AppState نجح`);
      try {
        await initBotLifecycle(api, index, {
          saveAppState:               saveAppStateForBot,
          onMqttEvent:                (event, _api, threads) =>
            dispatchMqttEvent(_api, event, label, threads),
          onFirstBotReady:            () => startCleanupInterval(),
        });
        try {
          const stopMonitor = startMonitoring(api, index, label);
          api._stopMonitor = stopMonitor;
        } catch (e) { console.warn(`[MONITOR:${label}] تعذّر بدء المراقبة:`, e?.message ?? e); }
        resolve(api);
      } catch (e) {
        console.error(`[BOT:${label}] ❌ خطأ في التهيئة:`, e.message);
        reject(e);
      }
    });
  });
}
