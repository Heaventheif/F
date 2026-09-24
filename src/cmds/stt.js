"use strict";
import http from "../utils/fetchHttp.js";
import { getHfBase, getInternalToken } from "../utils/hfClient.js";
const AUDIO_EXTS = ["mp3", "m4a", "ogg", "wav", "flac", "aac"];
function detectAudioAttachment(event) {
  const sources = [
    ...(event.attachments || []),
    ...(event.messageReply?.attachments || []),
  ];
  for (const att of sources) {
    if (!att) continue;
    const type = (att.type || att.attachmentType || "").toLowerCase();
    if (type === "audio" || type === "voice_message") {
      const url = att.url || att.audioUrl || att.uri;
      if (url) return { url, ext: "" };
    }
    if (type === "file" || type === "document") {
      const ext = (att.filename || att.name || "").split(".").pop().toLowerCase();
      const url = att.url || att.uri;
      if (url && AUDIO_EXTS.includes(ext)) return { url, ext };
    }
  }
  return null;
}
async function fetchTranscript(audioUrl, ext) {
  const { data } = await http.post(
    `${getHfBase()}/gemini/stt`,
    { audio_url: audioUrl, ext: ext || "" },
    { timeout: 60000, headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() } }
  );
  if (!data?.transcript) throw new Error(data?.error || "استجابة فارغة");
  return data.transcript;
}
export default {
  config: {
    name: "stt", 
    aliases: ["لنص"],
    version: "1.0.0",
    role: 0,
    countDown: 8,
    category: "ذكاء اصطناعي",
    description: "تفريغ (Transcribe) مقطع صوتي إلى نص — جسر إلى stt.go",
    usage: [
      "{pn}sst (كرد على مرفق صوتي) — يفرّغ الصوت إلى نص",
      "أرسل مقطعاً صوتياً مع الأمر مباشرة",
    ],
  },
  onStart: async ({ api, event, message }) => {
    const { threadID, messageID } = event;
    const att = detectAudioAttachment(event);
    if (!att) {
      return message.reply("❌ أرفق مقطعاً صوتياً أو رُدّ على رسالة فيها مقطع صوتي مع هذا الأمر.");
    }
    try {
      const transcript = await fetchTranscript(att.url, att.ext);
      return global.safeSend(api, `📝 ${transcript}`, threadID, null, messageID);
    } catch (e) {
      console.error("[STT→HF]", e.response?.status, e.message?.substring(0, 200));
      console.error("[stt:fetchTranscript]", e.message);
      const msg = e.response?.data?.error || e.message;
      await message.reply(`❌ فشل التفريغ: ${msg}`);
    }
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-ai-stt',
  meta: { category: 'command-ai', path: 'src/commands/ai/stt.js' },
  setup(_ctx) {
    // see module exports
  },
};
