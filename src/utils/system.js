import fs from "fs-extra";
import os from "os";
import path from "path";
import { buildRoleSets, buildBanSets } from "./access.js";
const _store      = new Map();
const MAX_ENTRIES = 1500;
function get(key) {
  const entry = _store.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    _store.delete(key);
    return null;
  }
  entry.gen = (_store._gen = (_store._gen || 0) + 1);
  return entry.value;
}
function set(key, value, ttlMs = 5 * 60 * 1000) {
  if (_store.size >= MAX_ENTRIES && !_store.has(key)) {
    let oldestKey = null;
    let oldestGen = Infinity;
    for (const [k, e] of _store) {
      if (e.gen < oldestGen) { oldestGen = e.gen; oldestKey = k; }
    }
    if (oldestKey) _store.delete(oldestKey);
  }
  _store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    gen: (_store._gen = (_store._gen || 0) + 1),
  });
  return value;
}
function sweep() {
  const now     = Date.now();
  let   removed = 0;
  for (const [key, entry] of _store) {
    if (now > entry.expiresAt) { _store.delete(key); removed++; }
  }
  return removed;
}
const cache = { get, set, sweep };
setInterval(() => {
  const removed = sweep();
  if (removed > 0) console.log(`[CACHE] 🧹 أُزيل ${removed} عنصر منتهي`);
}, 10 * 60 * 1000).unref();
function start(label) {
  const t0 = Date.now();
  const marks = [];
  let lastMark = t0;
  return {
    mark(name) {
      const now = Date.now();
      marks.push({ name, ms: now - lastMark });
      lastMark = now;
    },
    end(extra = "") {
      const total = Date.now() - t0;
      const breakdown = marks.length ? ` (${marks.map(m => `${m.name}=${m.ms}ms`).join(", ")})` : "";
      console.log(`[TIMING] ${label}: ${total}ms${breakdown}${extra ? " " + extra : ""}`);
      return total;
    },
  };
}
const timing = { start };
function buildChecks(projectRoot) {
  return [
    {
      level: "warn",
      key: null,
      label: "FB credentials",
      test: () => Boolean(process.env.APPSTATE?.trim()),
      message:
        "لا يوجد أي حساب مضاف بعد — افتح لوحة التحكم (/dashboard) وأضف حساب فيسبوك من تبويب AppState " +
        "(تسجيل الدخول يعتمد على AppState فقط، لا يوجد بديل بالبريد وكلمة المرور، ولا يُقرأ من متغيرات البيئة).",
    },
    {
      level: "warn",
      key: "HF_SPACE_URL",
      label: "HF_SPACE_URL",
      message: "أوامر chess/fb/gemini/groq/manga/novel/pin/song/tts لن تعمل",
    },
    {
      level: "warn",
      key: "INTERNAL_TOKEN",
      label: "INTERNAL_TOKEN",
      message: "طلبات hf-space ستُرفض بـ 401، وواجهات /yt/* ستبقى معطّلة (503)",
    },
  ];
}
function checkEnv(projectRoot) {
  let hasCritical = false;
  for (const check of buildChecks(projectRoot)) {
    const ok = check.test
      ? check.test()
      : !!(process.env[check.key] || "").trim();
    if (ok) continue;
    if (check.level === "critical") {
      console.error(`[ENV] ❌ CRITICAL — ${check.label}: ${check.message}`);
      hasCritical = true;
    } else if (check.level === "warn") {
      console.warn(`[ENV] ⚠️  ${check.label}: ${check.message}`);
    } else {
      console.log(`[ENV] ℹ️  ${check.label}: ${check.message}`);
    }
  }
  if (hasCritical) {
    console.error("[ENV] أضف APPSTATE صالحاً (مصفوفة JSON) إلى متغيرات البيئة قبل التشغيل");
  }
}
function loadConfig(projectRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, "config.json"), "utf8"));
    global.config = { ...global.config, ...cfg, Prefix: cfg.Prefix || ["."] };
  } catch (e) {
    console.warn(`[CONFIG] استخدام الإعدادات الافتراضية: ${e?.message ?? e}`);
  }
  buildRoleSets();
  buildBanSets();
}
const BOT_TMP_PREFIXES = [
  "fb_", "pin_", "tumblr_", "sc_", "tts_", "ydl_", "yt_", "yt2_", "yt_a_", "yt_v_",
  "manga_", "manga_3asq_", "comic_", "slap_", "canva_", "imagine_", "autodl_img_",
  "subtitled_", "media_", "groq-tts-", "song-",
];
function cleanupOrphanTempFiles() {
  try {
    const dir = os.tmpdir();
    const now = Date.now();
    let removed = 0;
    for (const name of fs.readdirSync(dir)) {
      if (!BOT_TMP_PREFIXES.some(p => name.startsWith(p))) continue;
      const fp = path.join(dir, name);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > 60 * 60 * 1000) {
          fs.removeSync(fp);
          removed++;
        }
      } catch (_) {}
    }
    if (removed) console.log(`[CLEANUP] 🗑️ حُذف ${removed} ملف مؤقت يتيم`);
  } catch (e) {
    console.warn("[CLEANUP] ⚠️ فشل تنظيف الملفات المؤقتة:", e.message);
  }
}
export { cache, timing, checkEnv, loadConfig, cleanupOrphanTempFiles };
