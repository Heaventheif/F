import http from "../utils/fetchHttp.js";
import { getHfBase, getInternalToken } from "../utils/hfClient.js";
import { loadCtx, saveCtx, clearCtx } from "../utils/sharedSession.js";
const COLLECTION = "gemini_sessions";
const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "heic", "bmp"];
function sanitizeName(name) {
  if (!name) return "مستخدم";
  const clean = String(name)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[[\]{}<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return clean || "مستخدم";
}
// اكتشف مرفق صورة في الرسالة أو الرسالة المُرد عليها.
function detectImageAttachment(event) {
  const sources = [
    ...(event.attachments || []),
    ...(event.messageReply?.attachments || []),
  ];
  for (const att of sources) {
    if (!att) continue;
    const type = (att.type || att.attachmentType || "").toLowerCase();
    // صورة صريحة
    if (type === "photo" || type === "image" || type === "sticker") {
      const url = att.url || att.previewUrl || att.uri;
      if (url) return { url, ext: "jpg" };
    }
    // ملف بامتداد صورة
    if (type === "file" || type === "document") {
      const ext = (att.filename || att.name || "").split(".").pop().toLowerCase();
      const url = att.url || att.uri;
      if (url && IMAGE_EXTS.includes(ext)) return { url, ext };
    }
  }
  return null;
}
// Call the Gemini chat proxy endpoint.
async function callHF(messages) {
  const { data } = await http.post(
    `${getHfBase()}/gemini`,
    { messages },
    { timeout: 30000, headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() } }
  );
  if (!data.reply) throw new Error("استجابة فارغة");
  return data;
}
// Call the /gemini/vision endpoint — تحليل الصورة.
async function callVision(imageUrl, ext, prompt) {
  const { data } = await http.post(
    `${getHfBase()}/gemini/vision`,
    { image_url: imageUrl, ext: ext || "jpg", prompt: prompt || "" },
    { timeout: 45000, headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() } }
  );
  if (!data.reply) throw new Error(data?.error || "استجابة فارغة");
  return data;
}
// Call the /gemini/search endpoint — بحث مباشر بالإنترنت.
async function callSearch(query) {
  const { data } = await http.post(
    `${getHfBase()}/gemini/search`,
    { query },
    { timeout: 45000, headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() } }
  );
  if (!data.reply) throw new Error("استجابة فارغة");
  return data;
}
// Format grounding sources into a readable footer.
function formatSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return "";
  const list = sources.slice(0, 5).map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `\n\n📎 المصادر:\n${list}`;
}
async function handleVision(api, event, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;
  const att = detectImageAttachment(event);
  if (!att) {
    // لا توجد صورة — تابع كمحادثة عادية
    return handle(api, event, prompt, registerReply);
  }
  let senderDisplayName = senderID;
  try {
    const userInfo = await new Promise((res, rej) =>
      api.getUserInfo(senderID, (err, d) => err ? rej(err) : res(d))
    );
    senderDisplayName = userInfo?.[senderID]?.name || senderID;
  } catch (_) {}
  senderDisplayName = sanitizeName(senderDisplayName);
  const question = prompt.trim() || "صف هذه الصورة بالتفصيل";
  let result;
  try {
    result = await callVision(att.url, att.ext, `[${senderDisplayName}]: ${question}`);
  } catch (e) {
    console.error("[VISION→HF]", e.response?.status, e.message?.substring(0, 100));
    return global.safeSend(api, `❌ فشل تحليل الصورة: ${e.message}`, threadID, null, messageID);
  }
  const sources = formatSources(result.sources);
  const fullReply = `🖼️ ${result.reply}${sources}`;
  global.safeSend(api, fullReply, threadID, (err, info) => {
    if (err || !info || !registerReply) return;
    // يمكن متابعة النقاش عن الصورة بعد الرد
    // Restrict follow-up to the original sender only (F-03 fix).
    registerReply(info.messageID, {}, async ({ api, event }) => {
      await handle(api, event, event.body?.trim() || "", registerReply);
    }, senderID);
  }, messageID);
}
async function handleSearch(api, event, query) {
  const { threadID, messageID } = event;
  if (!query.trim()) {
    return global.safeSend(api,
      "🔍 بحث فوري بالإنترنت\n\nمثال: .search آخر أخبار الذكاء الاصطناعي",
      threadID, null, messageID
    );
  }
  let result;
  try {
    result = await callSearch(query);
  } catch (e) {
    console.error("[SEARCH→HF]", e.response?.status, e.message?.substring(0, 60));
    return global.safeSend(api, "❌ فشل البحث، حاول لاحقاً.", threadID, null, messageID);
  }
  const sources = formatSources(result.sources);
  return global.safeSend(api, `🔍 ${result.reply}${sources}`, threadID, null, messageID);
}
async function handle(api, event, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;
  const sessionKey = threadID;
  if (["clear", "مسح", "reset"].includes(prompt.trim().toLowerCase())) {
    await clearCtx(COLLECTION, sessionKey);
    return global.safeSend(api, "🧹 تم مسح ذاكرة المجموعة.", threadID, null, messageID);
  }
  if (!prompt.trim()) {
    return global.safeSend(api,
      "🤖 Gemini AI\n\n" +
      ".gemini <سؤال> — محادثة بذاكرة\n" +
      ".gemini مسح — مسح الذاكرة\n" +
      "📷 أرسل صورة مع سؤالك — يحللها تلقائياً\n" +
      "🔍 .search <سؤال> — بحث فوري بالإنترنت",
      threadID, null, messageID
    );
  }
  let senderDisplayName = senderID;
  try {
    const userInfo = await new Promise((res, rej) =>
      api.getUserInfo(senderID, (err, d) => err ? rej(err) : res(d))
    );
    senderDisplayName = userInfo?.[senderID]?.name || senderID;
  } catch (_) {}
  senderDisplayName = sanitizeName(senderDisplayName);
  const ctx = await loadCtx(COLLECTION, sessionKey);
  const userContent = `[${senderDisplayName}]: ${prompt.trim()}`;
  const messages = [...ctx, { role: "user", content: userContent }];
  let result;
  try {
    result = await callHF(messages);
  } catch (e) {
    console.error("[GEMINI→HF]", e.response?.status, e.message?.substring(0, 60));
    const msg = e.message?.includes("HF_SPACE_URL")
      ? "❌ HF_SPACE_URL غير مضبوط في متغيرات البيئة."
      : "❌ الخادم غير متاح حالياً، حاول لاحقاً.";
    return global.safeSend(api, msg, threadID, null, messageID);
  }
  const reply = result.reply;
  const sources = formatSources(result.sources);
  const fullReply = reply + sources;
  global.safeSend(api, fullReply, threadID, (err, info) => {
    if (err || !info || !registerReply) return;
    // Restrict follow-up to the original sender only (F-03 fix).
    registerReply(info.messageID, {}, async ({ api, event }) => {
      await handle(api, event, event.body?.trim() || "", registerReply);
    }, senderID);
  }, messageID);
  await saveCtx(COLLECTION, sessionKey, [
    ...ctx,
    { role: "user",      content: userContent },
    { role: "assistant", content: reply },
  ]);
}
export default {
  config: {
    name: "gemini",
    aliases: ["بوت"],
    version: "1.0.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    category: "ذكاء اصطناعي",
    description: "دردشة ذكية + تحليل صور + بحث فعلي بالإنترنت — Gemini  ",
    usage: [
      "{pn}gemini <سؤال> — محادثة بذاكرة جماعية",
      "{pn}gemini مسح — مسح ذاكرة المحادثة",
      "{pn}gemini (+ صورة) — تحليل الصورة والإجابة",
      "{pn}gemini <سؤال> (+ صورة) — سؤال محدد عن الصورة",
      "{pn}search <سؤال> — بحث فوري بالإنترنت",
    ],
  },
  onStart: async ({ api, event, args, message }) => {
    const cmdName = (event.command || "").toLowerCase();
    const prompt = args.join(" ").trim() || event.messageReply?.body || "";
    if (cmdName === "search") {
      return handleSearch(api, event, prompt);
    }
    // تحقق من وجود صورة أولاً
    if (detectImageAttachment(event)) {
      return handleVision(api, event, prompt, message?.registerReply);
    }
    await handle(api, event, prompt, message?.registerReply);
  },
  onReply: async ({ api, event, message }) => {
    const prompt = event.body?.trim() || "";
    // إذا جاء الرد مع صورة
    if (detectImageAttachment(event)) {
      return handleVision(api, event, prompt, message?.registerReply);
    }
    await handle(api, event, prompt, message?.registerReply);
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-ai-gemini',
  meta: { category: 'command-ai', path: 'src/commands/ai/gemini.js' },
  setup(_ctx) {
    // see module exports
  },
};
