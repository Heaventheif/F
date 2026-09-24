import fs from "fs";
import os from "os";
import path from "path";
import http from "../utils/fetchHttp.js";
import { getHfBase, getInternalToken } from "../utils/hfClient.js";
import { loadCtx as _loadCtx, saveCtx as _saveCtx, clearCtx } from "../utils/sharedSession.js";
const COLLECTION = "groq_sessions";
const loadCtx = (id) => _loadCtx(COLLECTION, id);
const saveCtx = (id, msgs) => _saveCtx(COLLECTION, id, msgs);
async function downloadImageAsBase64(url) {
  try {
    const response = await http.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const contentType = response.headers["content-type"] || "image/jpeg";
    const base64 = Buffer.from(response.data).toString("base64");
    return { base64, contentType };
  } catch (e) {
    console.warn("[GROQ] Failed to download image:", e.message?.substring(0, 60));
    return null;
  }
}
function detectAttachment(event) {
  const sources = [
    ...(event.attachments               || []),
    ...(event.messageReply?.attachments || []),
  ];
  for (const att of sources) {
    if (!att) continue;
    const type = (att.type || att.attachmentType || "").toLowerCase();
    if (["photo","image","sticker","animated_image","share"].includes(type)) {
      const url =
        att.largePreviewUrl || att.previewUrl ||
        att.largePreviewUri || att.previewUri ||
        att.uri || att.url  || att.thumbnailUrl ||
        att.image?.uri;
      if (url) return { kind: "image", url };
    }
    if (type === "audio" || type === "voice_message") {
      const url = att.url || att.audioUrl || att.uri;
      if (url) return { kind: "audio", url };
    }
    if (type === "video" || type === "video_inline") {
      const url = att.url || att.uri || att.previewUrl;
      if (url) return { kind: "video", url };
    }
    if (type === "file" || type === "document") {
      const ext = (att.filename || att.name || "").split(".").pop().toLowerCase();
      const url = att.url || att.uri;
      if (!url) continue;
      if (["jpg","jpeg","png","gif","webp","bmp"].includes(ext))
        return { kind: "image", url };
      if (["mp3","m4a","ogg","wav","flac","aac"].includes(ext))
        return { kind: "audio", url };
      if (["mp4","mov","avi","mkv","webm"].includes(ext))
        return { kind: "video", url };
    }
  }
  return null;
}
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
// Call backend service with messages and root-level attachment support
async function callHF(messages, attachment, prompt, wantsVoice) {
  const body = { messages };
  if (attachment) body.attachment = attachment;
  if (prompt !== undefined && prompt !== null) body.prompt = prompt;
  if (wantsVoice) body.tts = true;
  const { data } = await http.post(
    `${getHfBase()}/groq`,
    body,
    { timeout: 60000, headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() } }
  );
  if (!data.reply) throw new Error(data.error || "استجابة فارغة");
  return data;
}
// Write base64 audio to a temp file and send it as a voice-note attachment.
// Returns the sent message's info (so callers can register follow-up replies on it).
async function sendVoiceReply(api, threadID, messageID, audioBase64, format = "wav") {
  const tmpPath = path.join(
    os.tmpdir(),
    `groq-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`
  );
  try {
    fs.writeFileSync(tmpPath, Buffer.from(audioBase64, "base64"));
    const info = await new Promise((resolve, reject) =>
      api.sendMessage(
        { attachment: fs.createReadStream(tmpPath) },
        threadID,
        (err, info) => (err ? reject(err) : resolve(info)),
        messageID
      )
    );
    return info;
  } catch (e) {
    console.warn("[GROQ] Failed to send voice reply:", e.message?.substring(0, 80));
    return null;
  } finally {
    fs.unlink(tmpPath, () => {});
  }
}
async function handle(api, event, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;
  const sessionKey = threadID;
  // إذا كان المستخدم يرد على رسالة نصية، أضف نصها كسياق
  const repliedBody = event.messageReply?.body?.trim();
  if (repliedBody && !["clear","مسح","reset"].includes(prompt.trim().toLowerCase())) {
    prompt = prompt.trim()
      ? `[رد على]: "${repliedBody}"\n${prompt.trim()}`
      : `[رد على]: "${repliedBody}"`;
  }
  if (["clear","مسح","reset"].includes(prompt.trim().toLowerCase())) {
    await clearCtx(COLLECTION, sessionKey);
    return global.safeSend(api, "🧹 تم مسح ذاكرة المجموعة.", threadID, null, messageID);
  }
  const wantsVoice = true;
  const attachment = detectAttachment(event);
  if (!prompt.trim() && !attachment) {
    return global.safeSend(api, 
      "❓ اكتب سؤالك أو أرسل صورة/صوت/فيديو، وسأرد عليك بصوت 🔊!\n" +
      "مثال: .groq كم ناتج 1+8؟\n" +
      ".groq مسح — لمسح ذاكرة المجموعة",
      threadID, null, messageID
    );
  }
  let senderName = senderID;
  try {
    const userInfo = await new Promise((res, rej) =>
      api.getUserInfo(senderID, (err, data) => err ? rej(err) : res(data))
    );
    senderName = userInfo?.[senderID]?.name || senderID;
  } catch (_) {}
  senderName = sanitizeName(senderName);
  let statusMsgId = null;
  try {
    const sent = await new Promise((resolve, reject) =>
      global.safeSend(api, 
        attachment
          ? `⏳ جاري تحليل ${attachment.kind === "image" ? "الصورة 🖼️" : attachment.kind === "audio" ? "الصوت 🎵" : "الفيديو 🎬"}...`
          : "⏳ جاري توليد الرد الصوتي 🔊...",
        threadID,
        (err, info) => err ? reject(err) : resolve(info),
        messageID
      )
    );
    statusMsgId = sent?.messageID;
  } catch (_) {}
  const updateStatus = async (text) => {
    try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
  };
  const ctx = await loadCtx(sessionKey);
  const displayPrompt = prompt.trim() || (attachment?.kind === "audio" ? "فرّغ هذا الصوت" : attachment?.kind === "video" ? "حلل هذا الفيديو" : "وصف هذه الصورة");
  const attPrefix = attachment ? `[${attachment.kind === "image" ? "صورة" : attachment.kind === "audio" ? "صوت" : "فيديو"}] ` : "";
  const userContent = `[${senderName}]: ${attPrefix}${displayPrompt}`.trim();
  let userMsg;
  let rootAttachment = null;
  if (attachment?.kind === "image") {
    const imgData = await downloadImageAsBase64(attachment.url);
    if (imgData) {
      userMsg = {
        role: "user",
        content: `[${senderName}]: ${prompt.trim() || "وصف هذه الصورة"}`,
      };
      rootAttachment = {
        kind:        "image",
        base64:      imgData.base64,
        contentType: imgData.contentType,
      };
    } else {
      userMsg = { role: "user", content: `[${senderName}]: ${prompt.trim() || "وصف هذه الصورة"}` };
      await updateStatus("⚠️ تعذّر تحميل الصورة، سأجيب على النص فقط...");
    }
  } else if (attachment) {
    userMsg = {
      role: "user",
      content: `[${senderName}]: ${displayPrompt}`,
    };
    rootAttachment = { kind: attachment.kind, url: attachment.url };
  } else {
    userMsg = { role: "user", content: userContent };
  }
  const messages = [...ctx, userMsg];
  let result;
  try {
    result = await callHF(messages, rootAttachment, prompt.trim(), wantsVoice);
  } catch (e) {
    console.error("[GROQ→HF]", e.response?.status, e.message?.substring(0, 80));
    console.error("[groq:callHF]", e.message);
    const msg = e.message?.includes("HF_SPACE_URL")
      ? "❌ HF_SPACE_URL غير مضبوط في متغيرات البيئة."
      : "❌ الخادم غير متاح حالياً، حاول لاحقاً.";
    return updateStatus(msg);
  }
  const reply = result.reply;
  let followUpMsgId = statusMsgId;
  if (result.audio) {
    // نحذف رسالة الحالة "⏳ جاري..." بدل استبدالها بعلامة ✅ منفصلة —
    // المستخدم يفضّل عدم رؤية أي رسالة تأكيد قبل المقطع الصوتي نفسه.
    if (statusMsgId) {
      try { await api.unsendMessage(statusMsgId, threadID); } catch (_) {}
    }
    const voiceInfo = await sendVoiceReply(api, threadID, messageID, result.audio, result.audio_format || "wav");
    // نربط الرد المتابِع بالمقطع الصوتي نفسه بما إن رسالة الحالة حُذفت
    followUpMsgId = voiceInfo?.messageID || null;
  } else {
    // TTS unavailable — fall back to showing the text answer so the user isn't left with nothing.
    await updateStatus(
      (result.tts_error ? "⚠️ تعذّر توليد الصوت، إليك الرد نصياً:\n\n" : "") + reply
    );
  }
  if (followUpMsgId && registerReply) {
    // Restrict follow-up to the original sender only (F-03 fix).
    registerReply(followUpMsgId, {}, async ({ api, event }) => {
      await handle(api, event, event.body?.trim() || "", registerReply);
    }, senderID);
  }
  await saveCtx(sessionKey, [
    ...ctx,
    { role: "user",      content: userContent },
    { role: "assistant", content: reply },
  ]);
}
export default {
  config: {
    name: "groq",
    aliases: ["ذكاء"],
    version: "1.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    category: "ذكاء اصطناعي",
    description: "محادثة ذكية جماعية مع دعم التوجيه المتعدد للنماذج عبر Groq",
    usage: [
      "{pn}Ai4 <سؤالك> — يرد البوت برسالة صوتية 🔊",
      "{pn}Ai4 + صورة/صوت/فيديو مرفق — تحليل الوسائط والرد بصوت",
      "{pn}Ai4 مسح — مسح ذاكرة المحادثة الجماعية",
    ],
  },
  onStart: async ({ api, event, args, message }) => {
    const prompt = args.join(" ").trim() || "";
    await handle(api, event, prompt, message?.registerReply);
  },
  onReply: async ({ api, event, message }) => {
    await handle(api, event, event.body?.trim() || "", message?.registerReply);
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-ai-groq',
  meta: { category: 'command-ai', path: 'src/commands/ai/groq.js' },
  setup(_ctx) {
    // see module exports
  },
};
