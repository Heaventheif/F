"use strict";
import "./src/bootstrap.js";
import path from "path";
import { checkEnv, loadConfig, cleanupOrphanTempFiles } from "./src/utils/system.js";
const _reactionTimestamps  = new Map();
const _reactionListenerRaw = {};
const reactionListenerProxy = new Proxy(_reactionListenerRaw, {
  set(target, prop, value) {
    _reactionTimestamps.set(prop, Date.now());
    target[prop] = value;
    return true;
  },
  deleteProperty(target, prop) {
    _reactionTimestamps.delete(prop);
    delete target[prop];
    return true;
  }
});
global.client              = { reactionListener: reactionListenerProxy };
global._reactionTimestamps = _reactionTimestamps;
global.Kagenou             = { replies: {} };
global.config              = { admins: [], moderators: [], developers: [], vips: [], Prefix: [""], botName: "Sunken Bot" };
global.globalData          = new Map();
global.usersData           = new Map();
global.userCooldowns       = new Map();
global.commands            = new Map();
global.eventCommands       = [];
global.appState            = {};
global.botApi              = null;
global.botFatal            = null;
global.botApis             = [];
global.perfManager         = null;
global.db                  = null;
import "./src/utils/safeSend.js";
import { startWebServer }    from "./src/webServer.js";
import { loadCommands }      from "./src/core/Loader.js";
import {
  PROJECT_ROOT,
  loadAppState,
  loginBot,
} from "./src/fca/Client.js";
checkEnv(PROJECT_ROOT);
global.log = {
  info:    msg => console.log("[INFO]",    msg),
  warn:    msg => console.log("[WARN]",    msg),
  error:   msg => console.log("[ERROR]",   msg),
  success: msg => console.log("[SUCCESS]", msg),
};
loadConfig(PROJECT_ROOT);
const COMMANDS_DIR = path.join(PROJECT_ROOT, "cmds");
["SIGTERM", "SIGINT"].forEach(sig => {
  process.on(sig, async () => {
    console.log(`[SHUTDOWN] ${sig} — إيقاف الجلسة...`);
    const api = global.botApi;
    if (api) {
      try { await api.__stopSessionLifecycle?.(); } catch (e) { console.warn("[SHUTDOWN] stop failed:", e?.message ?? e); }
    }
    process.exit(0);
  });
});
const FATAL_LOGIN = /checkpoint|appstate|login approvals|not logged in/i;
async function loginWithBackoff(account, { baseMs = 5_000, capMs = 600_000, max = 8 } = {}) {
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await loginBot(account);
    } catch (err) {
      const msg = String(err?.message ?? err);
      console.error(`[LOGIN] محاولة ${attempt}/${max}: ${msg}`);
      if (FATAL_LOGIN.test(msg)) { err.fatal = true; throw err; }
      if (attempt === max) throw err;
      const ceiling = Math.min(capMs, baseMs * 2 ** (attempt - 1));
      await new Promise((r) => setTimeout(r, 1_000 + Math.random() * ceiling));
    }
  }
}
const startBot = async () => {
  startWebServer();
  cleanupOrphanTempFiles();
  await loadCommands(COMMANDS_DIR);
  const account = loadAppState();
  if (!account) {
    console.error("[LOGIN] ❌ لا يوجد APPSTATE — أضف APPSTATE في متغيرات البيئة.");
    global.botFatal = "APPSTATE missing";
    return;
  }
  console.log("[BOT] 🚀 تسجيل الدخول بحساب واحد...");
  try {
    await loginWithBackoff(account);
    global.botFatal = null;
    console.log("[BOT] ✅ البوت متصل وجاهز.");
  } catch (err) {
    global.botFatal = err.message;
    if (err.fatal) {
      console.error("[BOT] ❌ خطأ دخول قاتل — يعمل في وضع متدهور (/ready يعيد 503):", err.message);
    } else {
      console.error("[BOT] ❌ استُنفدت محاولات الدخول المؤقتة — خروج لإعادة التشغيل:", err.message);
      process.exit(1);
    }
  }
};
startBot().catch((err) => {
  console.error("[FATAL_STARTUP]", err?.stack ?? err);
  process.exitCode = 1;
});
