function getHfBase() {
  const url = (process.env.HF_SPACE_URL || "").trim();
  if (!url) {
    throw new Error("HF_SPACE_URL غير مضبوط في متغيرات البيئة (Environment Variables)");
  }
  let u;
  try { u = new URL(url); } catch { throw new Error("HF_SPACE_URL ليس رابطاً صالحاً"); }
  if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) {
    throw new Error("HF_SPACE_URL يجب أن يستخدم https");
  }
  return url.replace(/\/+$/, "");
}
function getHfBaseOrNull() {
  try { return getHfBase(); } catch (_) { return null; }
}
let _warnedTokenFallback = false;
function getInternalToken() {
  if (process.env.HF_INTERNAL_TOKEN) return process.env.HF_INTERNAL_TOKEN;
  if (process.env.INTERNAL_TOKEN && !_warnedTokenFallback) {
    _warnedTokenFallback = true;
    console.warn("[AI] ⚠️ HF_INTERNAL_TOKEN غير مضبوط — يُستخدم INTERNAL_TOKEN كبديل. اضبط سرّاً منفصلاً للاتصال الصادر.");
  }
  return process.env.INTERNAL_TOKEN || "";
}
let _mongoose       = null;
let _connected      = false;
let _connectPromise = null;
let _retryAfter     = 0;
let _failures       = 0;
async function getMongoose() {
  if (_connected) return _mongoose;
  if (_connectPromise) return _connectPromise;
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "";
  if (!uri) return null;
  if (Date.now() < _retryAfter) return null;
  _connectPromise = (async () => {
    try {
      const mod   = await import("mongoose");
      _mongoose   = mod.default ?? mod;
      if (_mongoose.connection.readyState === 0) {
        await _mongoose.connect(uri, {
          dbName:                   "sunkenbot",
          serverSelectionTimeoutMS: 8000,
          socketTimeoutMS:          30000,
        });
      }
      _failures = 0;
      _connected = true;
      console.log("[SESSION] ✅ MongoDB متصل (جلسات AI)");
      return _mongoose;
    } catch (e) {
      _failures++;
      const ceil = Math.min(300_000, 5_000 * 2 ** Math.min(_failures - 1, 6));
      _retryAfter = Date.now() + ceil * (0.5 + Math.random() / 2);
      console.warn(`[SESSION] ⚠️ MongoDB غير متاح (#${_failures}) — RAM، المحاولة التالية بعد ~${Math.round(ceil / 1000)}ث: ${e.message}`);
      return null;
    } finally {
      if (!_connected) _connectPromise = null;
    }
  })();
  return _connectPromise;
}
const _models = new Map();
function getModel(mg, collectionName) {
  if (_models.has(collectionName)) return _models.get(collectionName);
  const schema = new mg.Schema(
    {
      _id:       String,
      messages:  { type: Array, default: [] },
      updatedAt: { type: Date,  default: Date.now },
    },
    { collection: collectionName }
  );
  const name  = collectionName.replace(/[^a-zA-Z0-9]/g, "_");
  const model = mg.models[name] ?? mg.model(name, schema);
  _models.set(collectionName, model);
  return model;
}
const _ram = new Map();
const RAM_MAX_KEYS = 2000;
function ramKey(col, id) { return `${col}::${id}`; }
export async function loadCtx(collectionName, id, limit = 20) {
  try {
    const mg = await getMongoose();
    if (mg) {
      const doc = await getModel(mg, collectionName)
        .findById(String(id), { messages: { $slice: -limit } })
        .lean();
      return doc?.messages ?? [];
    }
    return (_ram.get(ramKey(collectionName, id)) || []).slice(-limit);
  } catch (e) {
    console.warn(`[SESSION] loadCtx(${collectionName}) فشل — RAM:`, e?.message ?? e);
    return (_ram.get(ramKey(collectionName, id)) || []).slice(-limit);
  }
}
export async function saveCtx(collectionName, id, messages, limit = 20) {
  const sliced = messages.slice(-limit);
  try {
    const mg = await getMongoose();
    if (mg) {
      await getModel(mg, collectionName).updateOne(
        { _id: String(id) },
        { $set: { messages: sliced, updatedAt: new Date() } },
        { upsert: true }
      );
      return;
    }
  } catch (e) {
    console.warn(`[SESSION] saveCtx(${collectionName}) فشل — RAM:`, e?.message ?? e);
  }
  const k = ramKey(collectionName, id);
  _ram.delete(k);
  _ram.set(k, sliced);
  if (_ram.size > RAM_MAX_KEYS) _ram.delete(_ram.keys().next().value);
}
export async function clearCtx(collectionName, id) {
  try {
    const mg = await getMongoose();
    if (mg) {
      await getModel(mg, collectionName).deleteOne({ _id: String(id) });
      return;
    }
  } catch (e) {
    console.warn(`[SESSION] clearCtx(${collectionName}) فشل:`, e?.message ?? e);
  }
  _ram.delete(ramKey(collectionName, id));
}
const NAME_CACHE_TTL = 6 * 60 * 60 * 1000;
const NAME_CACHE_MAX = 2000;
const nameCache = new Map();
function sanitizeGroupName(value, fallback = "عضو") {
  const clean = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\[\]{}<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return clean || fallback;
}
function rememberName(senderID, name) {
  if (!senderID || !name) return;
  nameCache.set(String(senderID), { name, at: Date.now() });
  if (nameCache.size > NAME_CACHE_MAX) {
    const oldestKey = nameCache.keys().next().value;
    if (oldestKey) nameCache.delete(oldestKey);
  }
}
function fetchUserInfo(api, senderID) {
  if (!api?.getUserInfo || !senderID) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value || null);
    };
    const timer = setTimeout(() => finish(null), 2500);
    try {
      const result = api.getUserInfo(senderID, (error, data) => finish(error ? null : data));
      if (result && typeof result.then === "function") {
        result.then(finish, () => finish(null));
      } else if (result && typeof result === "object" && (
        result[senderID] || result.user || result.name || result.fullName || result.displayName
      )) {
        finish(result);
      }
    } catch (_) {
      finish(null);
    }
  });
}
export async function resolveGroupUsername(api, event) {
  const senderID = String(event?.senderID || "").trim();
  const eventName = event?.senderName || event?.userName || event?.username || event?.displayName || event?.name;
  if (eventName && String(eventName).trim() !== senderID) {
    const name = sanitizeGroupName(eventName);
    rememberName(senderID, name);
    return name;
  }
  const cached = senderID ? nameCache.get(senderID) : null;
  if (cached && Date.now() - cached.at < NAME_CACHE_TTL) return cached.name;
  const info = await fetchUserInfo(api, senderID);
  const item = info?.[senderID] || info?.[String(senderID)] || info?.user || info || {};
  const apiName = item?.name || item?.fullName || item?.displayName || item?.firstName;
  if (apiName && String(apiName).trim() !== senderID) {
    const name = sanitizeGroupName(apiName);
    rememberName(senderID, name);
    return name;
  }
  const fallback = senderID ? `عضو ${senderID.slice(-4)}` : "عضو";
  const name = sanitizeGroupName(fallback);
  rememberName(senderID, name);
  return name;
}
export function formatGroupTurn(username, content) {
  const speaker = sanitizeGroupName(username);
  const text = String(content || "").trim() || "[رسالة فارغة]";
  return `[${speaker}]: ${text}`;
}
function normalizeStoredUserTurn(turn) {
  const content = String(turn?.content || "").trim();
  const tagged = content.match(/^\[([^\]]{1,40})\]:\s*([\s\S]*)$/);
  const username = turn?.username || turn?.senderName || tagged?.[1] || "عضو سابق";
  const text = tagged && (!turn?.username && !turn?.senderName || tagged[1] === username)
    ? tagged[2]
    : content;
  return formatGroupTurn(username, text);
}
export function formatThreadHistory(history, limit = 12) {
  if (!Array.isArray(history)) return "";
  const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
  const selected = safeLimit ? history.slice(-safeLimit) : [];
  return selected.map(turn => {
    const content = String(turn?.content || "").trim();
    if (!content) return "";
    if (turn?.role === "assistant") return `البوت: ${content}`;
    return normalizeStoredUserTurn(turn);
  }).filter(Boolean).join("\n");
}
export function buildGroupPrompt(history, username, currentText, limit = 12) {
  const transcript = formatThreadHistory(history, limit);
  const sections = [
    "أنت مساعد داخل محادثة جماعية. الرسائل السابقة والحالية موسومة باسم أصحابها؛ حافظ على هذا التفريق، واستخدم سياق المجموعة عند متابعة النقاش، ولا تنسب كلام عضو إلى عضو آخر.",
  ];
  if (transcript) sections.push(`سياق المجموعة السابق:\n${transcript}`);
  sections.push(`الرسالة الحالية:\n${formatGroupTurn(username, currentText)}`);
  return sections.join("\n\n");
}
export { getHfBase, getHfBaseOrNull, getInternalToken };
