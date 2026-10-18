import http from "./fetchHttp.js";
import { cache } from "./system.js";
const BASE_URL = "https://smfahim.xyz";
const USER_AGENT = "Mozilla/5.0 SunkenBot/4.0";
function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}
function textValue(value) {
  if (typeof value === "string") return decodeHtml(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = textValue(item);
      if (found) return found;
    }
  }
  return "";
}
function extractTranslation(raw) {
  const candidates = [
    raw?.result,
    raw?.translation,
    raw?.translatedText,
    raw?.data?.translation,
    raw?.data?.translatedText,
    raw?.data?.texts?.map(item => item?.translation),
    raw?.raw?.data?.texts?.map(item => item?.translation),
    raw?.data?.result,
    raw?.data?.data?.translation,
  ];
  for (const candidate of candidates) {
    const value = textValue(candidate);
    if (value) return value;
  }
  return "";
}
function getTextFromKeys(raw, keys) {
  const roots = [raw, raw?.data, raw?.result, raw?.data?.data];
  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    for (const key of keys) {
      const value = textValue(root[key]);
      if (value) return value;
    }
  }
  return "";
}
function parseFactResponse(raw) {
  return getTextFromKeys(raw, ["fact", "text", "content", "result"]);
}
async function getJson(path, params = {}, timeout = 12_000) {
  const response = await http.get(`${BASE_URL}${path}`, {
    params,
    timeout,
    retries: 0,
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  const data = response.data;
  if (!data || data.success === false || data.status === false) {
    throw new Error("أعاد مزود Fahim نتيجة غير ناجحة.");
  }
  return data;
}
async function translateWithFahim(text, targetLang = "ar") {
  const input = String(text || "").trim();
  if (!input) return "";
  const endpoints = [
    { path: "/tools/translate/v7", params: { text: input, from: "auto", to: targetLang } },
    { path: "/tools/translate/v6", params: { text: input, to: targetLang, mode: "Creative" } },
    { path: "/tools/translate/v4", params: { text: input, from: "auto", to: targetLang } },
    { path: "/tools/translate/v3", params: { text: input, from: "auto", to: targetLang } },
  ];
  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const data = await getJson(endpoint.path, endpoint.params, 6_500);
      const translated = extractTranslation(data);
      if (translated) return translated;
      errors.push(`${endpoint.path}: استجابة ترجمة فارغة`);
    } catch (error) {
      errors.push(`${endpoint.path}: ${error.message}`);
    }
  }
  console.warn(`[FAHIM:translate] تعذرت كل المحاولات (${errors.length})`);
  return null;
}
async function getFahimFact() {
  const data = await getJson("/education/fact");
  const fact = parseFactResponse(data);
  if (!fact) throw new Error("لم تصل معلومة قابلة للعرض.");
  return fact;
}
let _googleXTranslate = null;
let _bingTranslate = null;
(async () => {
  try { _googleXTranslate = (await import("google-translate-api-x")).translate; } catch (_) {}
  try { _bingTranslate = (await import("bing-translate-api")).translate; } catch (_) {}
})();
async function getGoogleXTranslate() {
  if (_googleXTranslate) return _googleXTranslate;
  return (_googleXTranslate = (await import("google-translate-api-x")).translate);
}
async function getBingTranslate() {
  if (_bingTranslate) return _bingTranslate;
  return (_bingTranslate = (await import("bing-translate-api")).translate);
}
const TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_TEXT_LEN = 5000;
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: انتهت المهلة بعد ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function isRateLimited(e) {
  if (e?.statusCode === 429 || e?.status === 429 || e?.code === 429) return true;
  if (e?.name === "TooManyRequestsError") return true;
  const msg = String(e?.message || e || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("quota")
  );
}
function isProviderErrorText(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return (
    t.includes("query length limit exceeded") ||
    t.includes("max allowed query") ||
    text.includes("تجاوز حد طول الاستعلام") ||
    text.includes("الحد الأقصى المسموح به للاستعلام")
  );
}
const providers = [
  {
    name: "Google-X",
    blockedUntil: 0,
    cooldownMs: 10 * 60 * 1000,
    maxLen: MAX_TEXT_LEN,
    run: async (text, targetLang) => {
      const googleXTranslate = await getGoogleXTranslate();
      const res = await withTimeout(googleXTranslate(text, { to: targetLang }), TIMEOUT_MS, "Google-X");
      return res?.text ? String(res.text).trim() : null;
    }
  },
  {
    name: "Bing",
    blockedUntil: 0,
    cooldownMs: 15 * 60 * 1000,
    maxLen: MAX_TEXT_LEN,
    run: async (text, targetLang) => {
      const bingTranslate = await getBingTranslate();
      const res = await withTimeout(bingTranslate(text, null, targetLang), TIMEOUT_MS, "Bing");
      return res?.translation ? String(res.translation).trim() : null;
    }
  },
  {
    name: "Fahim",
    blockedUntil: 0,
    cooldownMs: 10 * 60 * 1000,
    maxLen: MAX_TEXT_LEN,
    run: async (text, targetLang) => translateWithFahim(text, targetLang)
  }
];
async function translateText(text, targetLang, fallbackToOriginal = true) {
  if (!text?.trim()) return text;
  const key = `tr_${targetLang}:${text}`;
  const cached = cache.get(key);
  if (cached) return cached;
  for (const provider of providers) {
    if (Date.now() < provider.blockedUntil) continue;
    if (provider.maxLen && text.length > provider.maxLen) continue;
    try {
      const result = await provider.run(text, targetLang);
      if (result && !isProviderErrorText(result)) {
        cache.set(key, result, CACHE_TTL_MS);
        return result;
      }
    } catch (e) {
      if (isRateLimited(e)) {
        provider.blockedUntil = Date.now() + provider.cooldownMs;
        console.warn(
          `[TRANSLATOR] حظر مؤقت لـ ${provider.name} (${provider.cooldownMs / 60000} دقيقة) — تحويل للمحرك التالي`
        );
      } else {
        console.warn(`[TRANSLATOR] خطأ في ${provider.name}:`, e.message?.substring(0, 80));
      }
    }
  }
  return fallbackToOriginal ? text : null;
}
async function translateTextStrict(text, targetLang) {
  return translateText(text, targetLang, false);
}
async function translateToArabic(text) {
  if (!text?.trim()) return text;
  if (/[\u0600-\u06FF]/.test(text) && text.match(/[\u0600-\u06FF]/g).length > text.length * 0.3) {
    return text;
  }
  return translateText(text, "ar");
}
async function translateToEnglish(text) {
  if (!text?.trim()) return text;
  const nonAsciiLetters = text.match(/[^\x00-\x7F]/g);
  if (!nonAsciiLetters || nonAsciiLetters.length < text.length * 0.15) {
    return text;
  }
  return translateText(text, "en");
}
function hasArabicText(value) {
  const text = String(value || "");
  const letters = text.match(/[\p{L}\p{N}]/gu) || [];
  const arabic = text.match(/[\u0600-\u06FF]/g) || [];
  return arabic.length > 0 && (letters.length === 0 || arabic.length / letters.length >= 0.18);
}
async function toArabicOutput(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("لا يوجد محتوى لترجمته.");
  if (hasArabicText(text)) return text;
  const translated = await translateTextStrict(text, "ar");
  if (!translated || !hasArabicText(translated)) {
    throw new Error("تعذرت ترجمة المحتوى إلى العربية حالياً.");
  }
  return translated.trim();
}
export { translateTextStrict, translateToArabic, translateToEnglish, toArabicOutput, getFahimFact };
