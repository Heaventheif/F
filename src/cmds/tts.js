"use strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import http from "../utils/fetchHttp.js";
import { getHfBase, getInternalToken } from "../utils/hfClient.js";
async function fetchTTS(text, voice) {
  const { data } = await http.post(
    `${getHfBase()}/gemini/tts`,
    { text, voice: voice || "" },
    {
      timeout: 120000,
      retries: 2,
      retryDelay: 500,
      // g returns 503 only after it has already tried the configured Groq keys.
      validateStatus: (status) => (status >= 200 && status < 300) || status === 503,
      headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() },
    }
  );
  if (!data?.audio_base64) {
    const error = new Error(data?.error || "استجابة فارغة");
    error.response = { status: 502, data };
    throw error;
  }
  return data;
}
export default {
  config: {
    name: "tts",
    aliases: ["قول"],
    version: "1.0.0",
    role: 0,
    countDown: 8,
    category: "ذكاء اصطناعي",
    description: "تحويل النص إلى صوت بلهجة سعودية عبر Groq Orpheus Arabic Saudi",
    usage: [
      "{pn}tts <نص> — يحوّل النص إلى صوت سعودي (Groq Orpheus)",
      "{pn}tts <voice-id> | <نص> — يختار صوتاً (مثال: fahad | مرحباً بالجميع)",
      "{pn}tts voices — يعرض أصوات Orpheus العربية السعودية المتاحة",
    ],
  },
  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID } = event;
    const raw = (args || []).join(" ").trim();
    if (!raw) {
      return message.reply(
        "🗣️ تحويل نص إلى صوت\n\n" +
        ".tts <نص> — صوت Groq Orpheus سعودي\n" +
        ".tts <voice-id> | <نص> — صوت محدد (مثل fahad)\n" +
        ".tts voices — عرض الأصوات المتاحة"
      );
    }
    if (raw.toLowerCase() === "voices" || raw === "أصوات") {
      try {
        const { data } = await http.get(
          `${getHfBase()}/gemini/tts/voices`,
          { timeout: 15000, headers: { "X-Internal-Token": getInternalToken() } }
        );
        const voices = Array.isArray(data.groq_voices) ? data.groq_voices : [];
        if (!voices.length) throw new Error("قائمة أصوات Groq فارغة");
        const list = voices.map((name) => `• ${name}`).join("\n");
        return global.safeSend(
          api,
          `🎙️ أصوات Groq Orpheus Arabic Saudi (${voices.length})\nالصوت الافتراضي: ${data.default_voice || "fahad"}\n${list}`,
          threadID, null, messageID
        );
      } catch (e) {
        console.error("[tts:voices]", e.message);
        return message.reply("❌ تعذّر جلب قائمة الأصوات، حاول لاحقاً.");
      }
    }
    let voice = "";
    let text = raw;
    const sepIdx = raw.indexOf("|");
    if (sepIdx !== -1) {
      voice = raw.slice(0, sepIdx).trim().toLowerCase();
      text = raw.slice(sepIdx + 1).trim();
    }
    if (!text) return message.reply("❌ النص فارغ.");
    let tmpFile;
    try {
      const { audio_base64, voice: usedVoice } = await fetchTTS(text, voice);
      const buffer = Buffer.from(audio_base64, "base64");
      tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}.wav`);
      await fs.writeFile(tmpFile, buffer);
      await global.safeSend(
        api,
        { body: `🎙️ ${usedVoice}`, attachment: fs.createReadStream(tmpFile) },
        threadID, null, messageID
      );
    } catch (e) {
      const status = e.response?.status;
      console.error("[TTS→Groq]", status, e.message?.substring(0, 200));
      console.error("[tts:fetchTTS]", e.message);
      const details = e.response?.data?.error || e.message || "خطأ غير معروف";
      const retryHint = status === 503
        ? " جرّب الخادم كل مفاتيح Groq المتاحة؛ تحقق من صلاحيتها أو أعد المحاولة لاحقاً."
        : [500, 502, 504].includes(status)
          ? " أعادت الخدمة المحاولة تلقائياً؛ أعد المحاولة بعد قليل إذا استمر العطل."
          : "";
      await message.reply(`❌ فشل توليد الصوت${status ? ` (HTTP ${status})` : ""}: ${String(details).slice(0, 300)}${retryHint}`);
    } finally {
      if (tmpFile) fs.remove(tmpFile).catch(() => {});
    }
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-ai-tts',
  meta: { category: 'command-ai', path: 'src/commands/ai/tts.js' },
  setup(_ctx) {
    // see module exports
  },
};
