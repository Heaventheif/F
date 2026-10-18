"use strict";
import crypto from "node:crypto";
import fs     from "node:fs";
import path   from "node:path";
export const EXPIRY_WARNING_MS  = 14 * 24 * 60 * 60 * 1_000;
export const EXPIRY_CRITICAL_MS =  3 * 24 * 60 * 60 * 1_000;
const REQUIRED_COOKIES    = ["c_user", "xs"];
const SESSION_COOKIES     = ["c_user", "xs", "fr", "sb", "datr", "wd", "locale"];
const CRITICAL_COOKIES    = ["c_user", "xs"];
export const STATE_FILE = process.env.FB_STATE_PATH ||
  path.join(process.env.STATE_DIR || path.resolve(process.cwd(), "data"), "appstate.enc");
const ALGO       = "aes-256-gcm";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
let _inMemoryState     = null;
let _inMemoryHash      = null;
export function readPersistedAppState() {
  return _atomicRead(STATE_FILE);
}
let _warnedKey = false;
function _getKey() {
  const k =
    process.env.FCA_STATE_KEY ||
    process.env.STATE_ENCRYPT_KEY ||
    process.env.APPSTATE_SECRET ||
    "";
  if (k.length < 32) {
    if (!_warnedKey) {
      _warnedKey = true;
      console.error("[APPSTATE] ❌ لا يوجد مفتاح تشفير (≥32 حرفاً: APPSTATE_SECRET/FCA_STATE_KEY) — الحفظ على القرص معطَّل");
    }
    return null;
  }
  return crypto.createHash("sha256").update(k, "utf8").digest();
}
function _encryptJson(obj) {
  const key = _getKey();
  if (!key) return null;
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data   = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"), ts: Date.now() };
}
function _decryptJson(p) {
  const key = _getKey();
  if (!key || !p || p.v !== 1) return null;
  try {
    const dec = crypto.createDecipheriv(ALGO, key, Buffer.from(p.iv, "base64"));
    dec.setAuthTag(Buffer.from(p.tag, "base64"));
    return JSON.parse(Buffer.concat([dec.update(Buffer.from(p.data, "base64")), dec.final()]).toString("utf8"));
  } catch (e) {
    console.warn(`[APPSTATE] ⚠️ تعذّر فك تشفير ملف الحالة (مفتاح خاطئ أو ملف تالف): ${e.message}`);
    return null;
  }
}
function _atomicWrite(filePath, obj) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = _encryptJson(obj);
    if (!payload) return false;
    fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
    fs.renameSync(tmp, filePath);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    console.warn(`[APPSTATE] ⚠️ فشل الحفظ المشفَّر: ${e.message}`);
    return false;
  }
}
function _atomicRead(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw.ts !== "number") return null;
    if (Date.now() - raw.ts > MAX_AGE_MS) {
      console.warn("[APPSTATE] ⚠️ ملف الحالة أقدم من 7 أيام — تجاهله");
      return null;
    }
    return _decryptJson(raw);
  } catch (e) {
    console.warn(`[APPSTATE] ⚠️ ملف الحالة غير مقروء: ${e.message}`);
    return null;
  }
}
export function mergeAppStates(existing, incoming) {
  const map = new Map();
  for (const c of (existing || [])) {
    const k = String(c?.key ?? c?.name ?? "");
    if (k) map.set(k, { ...c });
  }
  for (const c of (incoming || [])) {
    const k = String(c?.key ?? c?.name ?? "");
    if (!k) continue;
    map.set(k, map.has(k) ? { ...map.get(k), ...c } : { ...c });
  }
  return [...map.values()];
}
export function persistAppState(state, source = "auto") {
  if (!_validateAppState(state)) {
    console.warn(`[APPSTATE] ⚠️ persistAppState: حالة غير صالحة (${source})`);
    return false;
  }
  const onDisk     = _atomicRead(STATE_FILE);
  const existing   = mergeAppStates(onDisk, _inMemoryState);
  const merged     = mergeAppStates(existing, state);
  const normalized = _normalizeAppState(merged);
  const newHash    = _hashState(normalized);
  if (newHash === _inMemoryHash && onDisk &&
      newHash === _hashState(_normalizeAppState(onDisk))) return false;
  _updateMemoryCache(normalized, newHash);
  globalThis.appState = normalized;
  const saved = _atomicWrite(STATE_FILE, normalized);
  console.log(`[APPSTATE] 💾 حُفظ (${normalized.length} cookie | ${source}${saved ? " | 🔒disk" : ""})`);
  return true;
}
export function checkAppStateExpiry(appState, warningMs = EXPIRY_WARNING_MS) {
  if (!Array.isArray(appState)) return { expiring: false, critical: false, minTtlMs: Infinity, expiresAt: null, expiringSoon: [], criticalCookies: [] };
  const now = Date.now();
  let minTtl = Infinity, minExp = null;
  const expiringSoon = [], criticalList = [];
  for (const cookie of appState) {
    const name = String(cookie?.key ?? cookie?.name ?? "");
    const exp  = cookie?.expires;
    if (!exp || exp === "Infinity" || exp === Infinity) continue;
    const expMs = exp instanceof Date ? exp.getTime() : typeof exp === "string" ? new Date(exp).getTime() : typeof exp === "number" ? (exp < 1e12 ? exp * 1_000 : exp) : NaN;
    if (isNaN(expMs) || expMs <= 0) continue;
    const ttl = expMs - now;
    if (ttl < minTtl) { minTtl = ttl; minExp = new Date(expMs); }
    if (ttl < warningMs && SESSION_COOKIES.includes(name)) {
      expiringSoon.push(`${name}(${Math.round(ttl / 86_400_000)}d)`);
      if (ttl < EXPIRY_CRITICAL_MS && CRITICAL_COOKIES.includes(name)) criticalList.push(name);
    }
  }
  if (criticalList.length > 0) console.error(`[APPSTATE] 🚨 كوكيز حرجة قريبة الانتهاء: ${criticalList.join(", ")}`);
  else if (expiringSoon.length > 0) console.warn(`[APPSTATE] ⏰ كوكيز تقترب من الانتهاء: ${expiringSoon.join(", ")}`);
  return { expiring: minTtl < warningMs, critical: criticalList.length > 0, minTtlMs: minTtl === Infinity ? Infinity : Math.max(0, minTtl), expiresAt: minExp, expiringSoon, criticalCookies: criticalList };
}
function _validateAppState(state) {
  if (!Array.isArray(state) || state.length === 0) return false;
  const keys = new Set(state.map(c => String(c?.key ?? c?.name ?? "")));
  return REQUIRED_COOKIES.every(k => keys.has(k));
}
function _normalizeAppState(state) {
  return state.map(cookie => {
    const key = String(cookie?.key ?? cookie?.name ?? "").trim();
    return { key, value: String(cookie?.value ?? ""), domain: cookie?.domain ?? ".facebook.com", path: cookie?.path ?? "/", secure: cookie?.secure ?? true, httpOnly: cookie?.httpOnly ?? false, expires: cookie?.expires ?? "Infinity" };
  }).filter(c => c.key);
}
function _hashState(state) {
  try { return crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex"); }
  catch { return null; }
}
function _updateMemoryCache(state, hash = null) {
  _inMemoryState = state;
  _inMemoryHash  = hash ?? _hashState(state);
}
