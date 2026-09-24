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
    { timeout: 60000, headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() } }
  );
  if (!data?.audio_base64) throw new Error(data?.error || "استجابة فارغة");
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
    description: "تحويل نص إلى صوت مسموع (Gemini TTS) — جسر إلى tts.go",
    usage: [
      "{pn}tts <نص> — يحوّل النص إلى مقطع صوتي بصوت عشوائي",
      "{pn}tts <اسم الصوت> | <نص> — يحوّل النص بصوت محدد (مثال: Kore | مرحباً بالجميع)",
      "{pn}tts voices — يعرض قائمة الأصوات المتاحة",
    ],
  },
  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID } = event;
    const raw = (args || []).join(" ").trim();
    if (!raw) {
      return message.reply(
        "🗣️ تحويل نص إلى صوت\n\n" +
        ".tts <نص> — صوت عشوائي\n" +
        ".tts <اسم الصوت> | <نص> — صوت محدد\n" +
        ".tts voices — عرض الأصوات المتاحة"
      );
    }
    if (raw.toLowerCase() === "voices" || raw === "أصوات") {
      try {
        const { data } = await http.get(
          `${getHfBase()}/gemini/tts/voices`,
          { timeout: 15000, headers: { "X-Internal-Token": getInternalToken() } }
        );
        const list = (data.voices || []).join("، ");
        return global.safeSend(api, `🎙️ الأصوات المتاحة (${data.count}):\n${list}`, threadID, null, messageID);
      } catch (e) {
        console.error("[tts:voices]", e.message);
        return message.reply("❌ تعذّر جلب قائمة الأصوات، حاول لاحقاً.");
      }
    }
    let voice = "";
    let text = raw;
    const sepIdx = raw.indexOf("|");
    if (sepIdx !== -1) {
      voice = raw.slice(0, sepIdx).trim();
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
      console.error("[TTS→HF]", e.response?.status, e.message?.substring(0, 200));
      console.error("[tts:fetchTTS]", e.message);
      const msg = e.response?.data?.error || e.message;
      await message.reply(`❌ فشل توليد الصوت: ${msg}`);
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
