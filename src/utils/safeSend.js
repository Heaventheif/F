"use strict";
import fs from "node:fs";
const RATE_LIMIT_RE = /429|405|rate.?limit|too many/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function backoffGate(gate, tag) {
  const ms = 30_000 + Math.floor(Math.random() * 30_000);
  gate.lastSendAt = Math.max(gate.lastSendAt, Date.now() + ms);
  console.warn(`[${tag}] ⚠️ rate-limited — cooldown ${Math.round(ms / 1000)}s`);
}
const GLOBAL_MIN_GAP_MS = Math.max(0, Number.parseInt(process.env.GLOBAL_SEND_GAP_MS || "", 10) || 400);
let _globalChain = Promise.resolve();
let _globalLast  = 0;
function globalPace() {
  const p = _globalChain.then(async () => {
    const wait = GLOBAL_MIN_GAP_MS - (Date.now() - _globalLast);
    if (wait > 0) await sleep(wait);
    _globalLast = Date.now();
  });
  _globalChain = p.catch(() => {});
  return p;
}
export async function runThrottled(items, worker, { gapMs = 2000, jitterMs = 800 } = {}) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await sleep(gapMs + Math.random() * jitterMs);
    try {
      out.push({ item: items[i], ok: true, value: await worker(items[i]) });
    } catch (error) {
      out.push({ item: items[i], ok: false, error });
      if (RATE_LIMIT_RE.test(String(error?.message ?? error ?? ""))) {
        for (const rest of items.slice(i + 1))
          out.push({ item: rest, ok: false, error: new Error("skipped: rate-limited") });
        break;
      }
    }
  }
  return out;
}
const MIN_SEND_GAP_MS      = 1_500;
const PRIORITY_SEND_GAP_MS =   800;
const JITTER_RANGE_MS      =   400;
const configuredSendTimeout = Number.parseInt(process.env.FB_SEND_TIMEOUT_MS || "", 10);
const SEND_TIMEOUT_MS = Number.isSafeInteger(configuredSendTimeout) && configuredSendTimeout > 0
  ? Math.min(configuredSendTimeout, 300_000) : 60_000;
function sendWithTimeout(startSend) {
  let timer;
  const sendPromise = Promise.resolve().then(startSend);
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Facebook sendMessage timed out after ${SEND_TIMEOUT_MS}ms`)), SEND_TIMEOUT_MS);
  });
  return Promise.race([sendPromise, timeoutPromise]).finally(() => clearTimeout(timer));
}
const _threadGates = new Map();
function _gate(key, gapMs) {
  let gate = _threadGates.get(key);
  if (!gate) {
    gate = { promise: Promise.resolve(), lastSendAt: 0 };
    _threadGates.set(key, gate);
  }
  return gate;
}
const MAX_FB_MSG_LEN = 19_500;
function splitMessage(text) {
  if (text.length <= MAX_FB_MSG_LEN) return [text];
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = start + MAX_FB_MSG_LEN;
    if (end < text.length) {
      const lastNl = text.lastIndexOf("\n", end);
      if (lastNl > start) end = lastNl + 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}
function gatedSend(api, body, threadID, callback, messageID) {
  if (typeof body === "string" && body.length > MAX_FB_MSG_LEN) {
    const parts = splitMessage(body);
    console.warn(`[SEND] ⚠️ رسالة طويلة (${body.length} حرف) — تُقسَّم إلى ${parts.length} جزء.`);
    let chain = Promise.resolve();
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      chain = chain.then(() =>
        _gatedSendRaw(api, part, threadID, isLast ? callback : undefined, isLast ? messageID : undefined)
      );
    });
    return chain;
  }
  return _gatedSendRaw(api, body, threadID, callback, messageID);
}
function _gatedSendRaw(api, body, threadID, callback, messageID) {
  const rawApi = api.__rawApi || api;
  const key    = String(threadID);
  const gate   = _gate(key, MIN_SEND_GAP_MS);
  const resultPromise = gate.promise.then(async () => {
    const _jitter = Math.floor(Math.random() * JITTER_RANGE_MS) - (JITTER_RANGE_MS >> 1);
    const wait = (MIN_SEND_GAP_MS + _jitter) - (Date.now() - gate.lastSendAt);
    if (wait > 0) await sleep(wait);
    gate.lastSendAt = Date.now();
    let result;
    try {
      await globalPace();
      result = await sendWithTimeout(() => messageID !== undefined
        ? rawApi.sendMessage(body, threadID, callback, messageID)
        : rawApi.sendMessage(body, threadID, callback));
    } catch (sendErr) {
      const errMsg = String(sendErr?.message ?? sendErr ?? "");
      if (RATE_LIMIT_RE.test(errMsg)) backoffGate(gate, "SEND");
      throw sendErr;
    }
    return result;
  });
  gate.promise = resultPromise.catch(e => { console.error("[SEND] خطأ:", e.message); });
  return resultPromise;
}
function prioritySend(api, body, threadID, callback, messageID) {
  const rawApi = api.__rawApi || api;
  const key    = String(threadID);
  const gate   = _gate(key, PRIORITY_SEND_GAP_MS);
  const resultPromise = gate.promise.then(async () => {
    const _jitter = Math.floor(Math.random() * JITTER_RANGE_MS) - (JITTER_RANGE_MS >> 1);
    const wait = (PRIORITY_SEND_GAP_MS + _jitter) - (Date.now() - gate.lastSendAt);
    if (wait > 0) await sleep(wait);
    gate.lastSendAt = Date.now();
    let result;
    try {
      await globalPace();
      result = await sendWithTimeout(() => messageID !== undefined
        ? rawApi.sendMessage(body, threadID, callback, messageID)
        : rawApi.sendMessage(body, threadID, callback));
    } catch (e) {
      if (RATE_LIMIT_RE.test(String(e?.message ?? e ?? ""))) backoffGate(gate, "PRIORITY_SEND");
      throw e;
    }
    return result;
  });
  gate.promise = resultPromise.catch(e => { console.error("[PRIORITY_SEND] خطأ:", e.message); });
  return resultPromise;
}
const _mediaGapEnv = Number.parseInt(process.env.MEDIA_GAP_MS ?? "", 10);
const MEDIA_GAP_MS = Number.isFinite(_mediaGapEnv) && _mediaGapEnv >= 0 ? _mediaGapEnv : 1_200;
function mediaSend(api, body, threadID, callback, messageID) {
  const rawApi = api.__rawApi || api;
  const gate   = _gate(String(threadID), PRIORITY_SEND_GAP_MS);
  let wait = 0;
  if (MEDIA_GAP_MS > 0) {
    const startAt = Math.max(Date.now(), gate.mediaNextAt || 0);
    gate.mediaNextAt = startAt + MEDIA_GAP_MS;
    wait = startAt - Date.now();
  }
  wait = Math.max(wait, gate.lastSendAt - Date.now());
  const p = new Promise((resolve, reject) => {
    let done = false;
    let timer = null;
    const finish = (err, info) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err && RATE_LIMIT_RE.test(String(err?.message ?? err))) backoffGate(gate, "MEDIA_SEND");
      if (typeof callback === "function") { try { callback(err, info); } catch (_) {} }
      err ? reject(err) : resolve(info);
    };
    timer = setTimeout(() => {
      const e = new Error(`Facebook sendMessage timed out after ${SEND_TIMEOUT_MS}ms`);
      e.isTimeout = true;
      finish(e);
    }, SEND_TIMEOUT_MS);
    const run = () => {
      if (done) return;
      try {
        const ret = messageID !== undefined
          ? rawApi.sendMessage(body, threadID, finish, messageID)
          : rawApi.sendMessage(body, threadID, finish);
        if (ret && typeof ret.then === "function") ret.then(() => {}, err => finish(err));
      } catch (e) { finish(e); }
    };
    const start = () => globalPace().then(run, run);
    if (wait > 0) setTimeout(start, wait); else start();
  });
  p.catch(() => {});
  return p;
}
async function mediaSendFile(api, filePath, threadID, messageID, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await mediaSend(api, { attachment: fs.createReadStream(filePath) }, threadID, undefined, messageID);
      return;
    } catch (e) {
      lastErr = e;
      if (e?.isTimeout || i + 1 >= attempts) break;
      console.warn(`[MEDIA_SEND] ⚠️ فشل الرفع (${String(e?.message ?? e).slice(0, 80)}) — إعادة محاولة`);
      await sleep(700);
    }
  }
  throw lastErr;
}
function cleanupIdleThreadGates() {
  const now     = Date.now();
  let   removed = 0;
  for (const [tid, g] of _threadGates.entries()) {
    if (now - g.lastSendAt > 30 * 60 * 1000) { _threadGates.delete(tid); removed++; }
  }
  return removed;
}
const _wrappedApiCache = new WeakMap();
function wrapApiForSafety(api) {
  if (_wrappedApiCache.has(api)) return _wrappedApiCache.get(api);
  const wrapped = Object.create(api);
  wrapped.__rawApi     = api;
  wrapped.sendMessage  = (body, threadID, callback, messageID) =>
    global.safeSend(api, body, threadID, callback, messageID);
  _wrappedApiCache.set(api, wrapped);
  return wrapped;
}
global.safeSend              = gatedSend;
global.prioritySend          = prioritySend;
global.mediaSend             = mediaSend;
global.mediaSendFile         = mediaSendFile;
global.wrapApiForSafety      = wrapApiForSafety;
global.runThrottled          = runThrottled;
global.cleanupIdleThreadGates = cleanupIdleThreadGates;
setInterval(() => {
  const removed = cleanupIdleThreadGates();
  if (removed > 0) console.log(`[SEND] 🧹 أُزيل ${removed} gate خامل من الذاكرة.`);
}, 30 * 60 * 1000).unref();
export { gatedSend, prioritySend, mediaSend, mediaSendFile, wrapApiForSafety, cleanupIdleThreadGates };
