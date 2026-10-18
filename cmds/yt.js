"use strict";
import fs from "fs-extra";
import { searchWithFallback, downloadWithFallback, cleanTemp } from "../src/utils/youtube.js";
import { splitFile, cleanupParts, NEEDS_SPLIT } from "../src/utils/media.js";
const EMOJI_PAIRS = [
  ["👍", "❤️"], ["😆", "😮"], ["😢", "😡"],
  ["🥰", "👏"], ["🤩", "😘"], ["😍", "😭"],
  ["🤔", "😅"], ["😁", "🥹"], ["🥸", "😎"], ["🙂", "😇"],
];
function attachReactionPicker({ sentMessageID, authorID, list, onPick, ttlMs = 120000 }) {
  if (!sentMessageID || !global.client?.reactionListener) return;
  const cleanup = () => {
    delete global.client.reactionListener[sentMessageID];
    if (global.Kagenou?.replies) delete global.Kagenou.replies[sentMessageID];
  };
  global.client.reactionListener[sentMessageID] = {
    author: authorID,
    callback: async ({ event: reactionEvent }) => {
      const reaction = reactionEvent.reaction;
      const idx = EMOJI_PAIRS.findIndex(([primary, alt]) => reaction === primary || reaction === alt);
      if (idx < 0 || idx >= list.length) return;
      const altChosen = reaction === EMOJI_PAIRS[idx][1];
      cleanup();
      await onPick(list[idx], altChosen);
    },
  };
  setTimeout(cleanup, ttlMs);
}
function buildListText(results, wantMp4) {
  let text = `${wantMp4 ? "🎬" : "🎵"} نتائج البحث:\n${"─".repeat(22)}\n`;
  results.forEach((v, i) => {
    const [mp3E, mp4E] = EMOJI_PAIRS[i];
    text +=
      `${i + 1}. ${v.title}\n` +
      `   ⏱ ${v.duration || "--"}${v.uploader ? `  📺 ${v.uploader}` : ""}\n` +
      `   ${mp3E} mp3  |  ${mp4E} mp4\n` +
      `${"─".repeat(22)}\n`;
  });
  text += `تفاعل بالإيموجي لاختيار الأغنية\n⏳ تنتهي بعد دقيقتين`;
  return text;
}
const HELP =
  "📥 يوتيوب دونلودر\n\n" +
  "🎵 yt <اسم>          — تحميل مباشر (MP3)\n" +
  "🎬 yt mp4 <اسم>      — تحميل مباشر (MP4)\n" +
  "📋 yt s <اسم>        — قائمة نتائج (MP3)\n" +
  "📋 yt s mp4 <اسم>    — قائمة نتائج (MP4)\n" +
  "🔗 yt <رابط>         — تحميل مباشر\n\n" +
  "🎚 الجودة: صوت 128kbps | فيديو 360p";
async function downloadAndSend(api, threadID, messageID, ytUrl, wantMp4, listMsgId = null) {
  let filePath = null;
  let partPaths = [];
  try {
    ({ filePath } = await downloadWithFallback(ytUrl, wantMp4));
    const { size } = await fs.stat(filePath);
    const files = NEEDS_SPLIT(size)
      ? (partPaths = await splitFile(filePath, wantMp4 ? "mp4" : "mp3"))
      : [filePath];
    for (const file of files) await global.mediaSendFile(api, file, threadID, messageID);
    if (listMsgId) { try { await api.unsendMessage(listMsgId, threadID); } catch (_) {} }
  } catch (_) {
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
    countDown: 0,
    category: "وسائط وتحميل",
    description: "تحميل من يوتيوب عبر Vreden مع بدائل تلقائية — أضف s لعرض قائمة، وmp4 للفيديو",
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
    if (!args[0]) return message.reply(HELP);
    const rest = [...args];
    const takeFlag = (word) => rest[0]?.toLowerCase() === word && !!rest.shift();
    const showList = takeFlag("s");
    const wantMp4 = takeFlag("mp4");
    const query = rest.join(" ").trim();
    if (!query) return message.reply("❌ أرسل اسم الأغنية أو الرابط.");
    if (/^https?:\/\//i.test(query)) {
      return downloadAndSend(api, threadID, messageID, query, wantMp4);
    }
    try {
      if (!showList) {
        const [first] = await searchWithFallback(query, 1);
        if (!first?.url) throw new Error("no results");
        return await downloadAndSend(api, threadID, messageID, first.url, wantMp4);
      }
      const list = (await searchWithFallback(query, 10)).slice(0, 10);
      const sent = await new Promise((res, rej) =>
        global.safeSend(api, buildListText(list, wantMp4), threadID,
          (err, info) => (err ? rej(err) : res(info)), messageID)
      );
      attachReactionPicker({
        sentMessageID: sent?.messageID,
        authorID: event.senderID,
        list,
        onPick: (chosen, asMp4) =>
          downloadAndSend(api, threadID, messageID, chosen.url, asMp4, sent.messageID),
      });
    } catch (_) {
      global.safeSend(api, "غير موجود.", threadID, null, messageID);
    }
  },
};
