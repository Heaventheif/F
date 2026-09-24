"use strict";
/**
 * src/core/Client.js — v4.0
 * ───────────────────────────
 * تحسينات v4.0:
 *  - يقرأ AppState من: env → ذاكرة → ملف مشفَّر (بقاء بعد التحطُّم)
 *  - يحفظ بـ mergeAppStates (لا يُقلِّص jar)
 *  - يتحقق من الكوكيز المطلوبة قبل الحفظ
 */

import fs   from "fs-extra";
import path from "path";
import { createRequire }  from "node:module";
import { fileURLToPath }  from "node:url";

const require = createRequire(import.meta.url);
const fcaNx   = require("fca-nx");
const login   = fcaNx.login ?? fcaNx.default ?? fcaNx;

import { readAppStateFromEnv, updateAppStateInMemory } from "../utils/runtimeEnv.js";
import { dispatchMqttEvent }    from "../events/onMessage.js";
import { startCleanupInterval } from "../events/onReady.js";
import { createMqttConnectionManager } from "./MqttConnectionManager.js";
import { initBotLifecycle }    from "./bot-init.js";
import { persistAppState, mergeAppStates } from "../utils/appStatePersist.js";
import { Watchdog }   from "../../fca-nx/src/safety/watchdog.js";
import { startMonitoring } from "./monitor.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.join(MODULE_DIR, "..", "..");

const STATE_DIR  = process.env.STATE_DIR || "/var/data";
const STATE_FILE = path.join(STATE_DIR, "appstate.enc");

// ── أسماء البوت ─────────────────────────────────────────────────────────────
const BOT_NAMES_FILE = path.join(PROJECT_ROOT, "botNames.json");

function loadBotNames() {
  try { if (fs.existsSync(BOT_NAMES_FILE)) return JSON.parse(fs.readFileSync(BOT_NAMES_FILE, "utf8")) || {}; }
  catch (_) {}
  return {};
}

function saveBotName(botIndex, name) {
  if (!name) return;
  try {
    const all = loadBotNames(); all[String(botIndex)] = name;
    const tmp = BOT_NAMES_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
    fs.renameSync(tmp, BOT_NAMES_FILE);
  } catch (_) {}
}

export function getBotName(botIndex) { return loadBotNames()[String(botIndex)] || null; }

// ── AppState — قراءة (env → ذاكرة → ملف مشفَّر) ───────────────────────────
export function loadAppState() {
  // 1. من البيئة
  let state = readAppStateFromEnv();
  if (state) return { state, index: 1, source: "APPSTATE" };

  // 2. من ملف مشفَّر (جديد v4.0 — يبقى بعد تحطُّم العملية)
  try {
    const { readDecrypted } = require("../fca-nx/src/utils/secureStore.js");
    const fromFile = readDecrypted?.(STATE_FILE);
    if (Array.isArray(fromFile) && fromFile.length) {
      console.warn("[APPSTATE] ⚠️ استعادة من الملف المشفَّر (البيئة فارغة)");
      return { state: fromFile, index: 1, source: "encrypted-file" };
    }
  } catch (_) {}

  return null;
}

export function loadAllAppStates() {
  const account = loadAppState();
  return account ? [account] : [];
}

// ── AppState — حفظ (merge + تشفير) ─────────────────────────────────────────
export function saveAppStateForBot(state, botIndex = 1, source = "runtime") {
  try {
    if (!Array.isArray(state) || state.length === 0) throw new Error("فارغ");
    const keys = new Set(state.map(c => String(c?.key ?? c?.name ?? "")));
    if (!keys.has("c_user") || !keys.has("xs")) throw new Error("cookies ناقصة");

    // تحديث في الذاكرة
    updateAppStateInMemory(state);

    // merge + تشفير على القرص (جديد v4.0)
    persistAppState(state, source);

    console.log(`[APPSTATE] ✅ حُفظ (${state.length} cookie | Bot-${botIndex} | ${source})`);
    return true;
  } catch (err) {
    console.warn(`[APPSTATE] ⚠️ ${err.message}`);
    return false;
  }
}

// ── خيارات fca-nx ─────────────────────────────────────────────────────────────
const GLOBAL_OPTIONS = {
  selfListen:     false,
  listenEvents:   true,
  forceLogin:     true,
  autoMarkRead:   false,
  updatePresence: false,
  online:         true,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/139.0.0.0 Safari/537.36",
};

// ── تسجيل الدخول ─────────────────────────────────────────────────────────────
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
          getBotName, saveBotName, createMqttConnectionManager,
        });

        // ── Watchdog (جديد v4.0 — من fca-unofficial) ─────────────────────
        const watchdog = new Watchdog({
          api,
          ctx:           api._ctx,
          silenceMs:     5 * 60 * 1000,
          onSilence:     () => api.__forceReconnect?.("watchdog-silence"),
        });
        watchdog.start();
        api._watchdog = watchdog;

        // ── مراقبة الصحة + تنبيه المشرف (جديد v4.0) ──────────────────────
        try {
          const stopMonitor = startMonitoring(api, index, label);
          api._stopMonitor = stopMonitor;
        } catch (_) {}

        resolve(api);
      } catch (e) {
        console.error(`[BOT:${label}] ❌ خطأ في التهيئة:`, e.message);
        reject(e);
      }
    });
  });
}

export const loginBotWithAppState = loginBot;
export { loadBotNames };
