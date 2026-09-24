"use strict";
import fs from "fs-extra";
import { searchWithFallback, downloadWithFallback, cleanTemp } from "../utils/ytProviders.js";
import { buildListText, attachReactionPicker } from "../utils/reactionPicker.js";
import { splitFile, cleanupParts, NEEDS_SPLIT } from "../utils/mediaSplitter.js";
async function downloadAndSend(api, threadID, messageID, ytUrl, wantMp4, listMsgId = null) {
  let filePath = null;
  let partPaths = [];
  try {
    const dl = await downloadWithFallback(ytUrl, wantMp4);
    filePath = dl.filePath;
    const fileSize = (await fs.stat(filePath)).size;
    const files = NEEDS_SPLIT(fileSize)
      ? (partPaths = await splitFile(filePath, wantMp4 ? "mp4" : "mp3"))
      : [filePath];
    for (let i = 0; i < files.length; i++) {
      await new Promise((res, rej) =>
        global.safeSend(api,
          { attachment: fs.createReadStream(files[i]) },
          threadID,
          err => err ? rej(err) : res(),
          messageID
        )
      );
    }
    if (listMsgId) { try { await api.unsendMessage(listMsgId, threadID); } catch (_) {} }
  } catch (err) {
    global.safeSend(api, "❌ تعذّر تحميل الملف.", threadID, null, messageID);
  } finally {
    if (partPaths.length) await cleanupParts(partPaths);
    await cleanTemp(filePath);
  }
}
export default {
  config: {
    name: "yt",
    aliases: ["يوتيوب"],
    version: "1.0.0",
    role: 0,
    countDown: 15,
    category: "وسائط وتحميل",
    description: "تحميل من يوتيوب (يجرّب عدة مزوّدين تلقائياً) — أضف s لعرض قائمة، وmp4 للفيديو",
    usage: [
      "{pn}يوتيوب <اسم> — تحميل أول نتيجة مباشرة (MP3)",
      "{pn}يوتيوب s <اسم> — عرض قائمة نتائج",
      "{pn}يوتيوب mp4 <اسم> — تحميل أول نتيجة مباشرة (MP4)",
      "{pn}يوتيوب s mp4 <اسم> — عرض قائمة نتائج (MP4)",
      "{pn}يوتيوب <رابط> — تحميل مباشر MP3",
      "{pn}يوتيوب mp4 <رابط> — تحميل مباشر MP4",
    ],
  },
  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;
    if (!args[0]) return message.reply(
      "📥 يوتيوب دونلودر\n\n" +
      "🎵 yt <اسم>          — تحميل مباشر (MP3)\n" +
      "🎬 yt mp4 <اسم>      — تحميل مباشر (MP4)\n" +
      "📋 yt s <اسم>        — قائمة نتائج (MP3)\n" +
      "📋 yt s mp4 <اسم>    — قائمة نتائج (MP4)\n" +
      "🔗 yt <رابط>         — تحميل مباشر\n\n" +
      "🎚 الجودة: صوت 128kbps | فيديو 360p"
    );
    let remaining = [...args];
    const showList = remaining[0]?.toLowerCase() === "s";
    if (showList) remaining = remaining.slice(1);
    const wantMp4 = remaining[0]?.toLowerCase() === "mp4";
    if (wantMp4) remaining = remaining.slice(1);
    const query = remaining.join(" ").trim();
    if (!query) return message.reply("❌ أرسل اسم الأغنية أو الرابط.");
    const isUrl = /^https?:\/\//i.test(query);
    if (isUrl) return await downloadAndSend(api, threadID, messageID, query, wantMp4);
    if (!showList) {
      try {
        const results = await searchWithFallback(query, 1);
        if (!results?.[0]?.url) return global.safeSend(api, "غير موجود.", threadID, null, messageID);
        return await downloadAndSend(api, threadID, messageID, results[0].url, wantMp4);
      } catch (e) {
        return global.safeSend(api, "غير موجود.", threadID, null, messageID);
      }
    }
    try {
      const results = await searchWithFallback(query, 10);
      const list = results.slice(0, 10);
      const sent = await new Promise((res, rej) =>
        global.safeSend(api, buildListText(list, wantMp4), threadID,
          (err, info) => err ? rej(err) : res(info), messageID)
      );
      attachReactionPicker({
        sentMessageID: sent?.messageID,
        authorID: event.senderID,
        list,
        onPick: (chosen, wantMp4Alt) =>
          downloadAndSend(api, threadID, messageID, chosen.url, wantMp4Alt, sent.messageID),
      });
    } catch (e) {
      global.safeSend(api, "غير موجود.", threadID, null, messageID);
    }
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-media-yt',
  meta: { category: 'command-media', path: 'src/commands/media/yt.js' },
  setup(_ctx) {
    // see module exports
  },
};
