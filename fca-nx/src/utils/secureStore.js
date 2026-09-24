"use strict";
/**
 * secureStore.js — AES-256-GCM encrypted AppState persistence
 * Synthesized from: fca-unofficial CookieRefresher + nkxfca appStateBackup + custom hardening
 */
const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");
const ALGO   = "aes-256-gcm";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function keyFromEnv() {
  const k = process.env.FCA_STATE_KEY || process.env.STATE_ENCRYPT_KEY || "";
  if (k.length < 32) throw new Error("[secureStore] FCA_STATE_KEY must be >=32 chars. Generate: openssl rand -hex 24");
  return crypto.createHash("sha256").update(k, "utf8").digest();
}

function encryptJson(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, keyFromEnv(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"), ts: Date.now() };
}

function decryptJson(p) {
  if (!p || p.v !== 1) throw new Error(`[secureStore] Unknown payload version: ${p?.v}`);
  const dec = crypto.createDecipheriv(ALGO, keyFromEnv(), Buffer.from(p.iv, "base64"));
  dec.setAuthTag(Buffer.from(p.tag, "base64"));
  return JSON.parse(Buffer.concat([dec.update(Buffer.from(p.data, "base64")), dec.final()]).toString("utf8"));
}

function atomicWriteEncrypted(filePath, stateObj) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(encryptJson(stateObj)), "utf8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

function readDecrypted(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw.ts !== "number") return null;
    if (Date.now() - raw.ts > MAX_AGE_MS) {
      console.warn("[secureStore] State file >7 days old — ignoring");
      return null;
    }
    return decryptJson(raw);
  } catch (err) {
    console.warn(`[secureStore] Decrypt failed: ${err.message}`);
    return null;
  }
}

function mergeAppStates(existing, incoming) {
  const map = new Map();
  for (const c of (existing || [])) { const k = String(c?.key ?? c?.name ?? ""); if (k) map.set(k, { ...c }); }
  for (const c of (incoming || [])) {
    const k = String(c?.key ?? c?.name ?? "");
    if (!k) continue;
    map.set(k, map.has(k) ? { ...map.get(k), ...c } : { ...c });
  }
  return [...map.values()];
}

module.exports = { encryptJson, decryptJson, atomicWriteEncrypted, readDecrypted, mergeAppStates };
