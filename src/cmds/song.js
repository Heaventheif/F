"use strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { youtubeMusicSearch } from "@hydralerne/youtube-api";

const execFileAsync = promisify(execFile);

const TRACK_EMOJIS = ["👍", "❤️", "😆", "😮", "😢", "😡", "🥰", "🤩"];
const LIST_SIZE = 7;
const LIST_TTL_MS = 120_000;

const HELP =
  "🎵 YouTube Music\n\n" +
  "song <اسم الأغنية>      — تشغيل أول نتيجة مباشرة\n" +
  "song s <اسم الأغنية>    — عرض قائمة للاختيار\n" +
  "(أو موسيقى بدل song)\n\n" +
  "مثال:\n" +
  "song after the dark mr kitty\n" +
  "song s mr kitty";

const cleanTemp = (p) => fs.remove(p).catch(() => {});

// ─── بحث ────────────────────────────────────────────────────────
async function searchTracks(query, limit) {
  const results = await youtubeMusicSearch(query, "songs");
  if (!Array.isArray(results) || !results.length)
    throw new Error("لم تُوجد نتائج على YouTube Music");
  return results.slice(0, limit);
}

// ─── تحميل عبر yt-dlp ──────────────────────────────────────────
async function downloadToTemp(videoId) {
  const url = `https://music.youtube.com/watch?v=${videoId}`;
  const filePath = path.join(os.tmpdir(), `yt_${Date.now()}_${randomUUID()}.mp3`);

  try {
    await execFileAsync("yt-dlp", [
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "-o", filePath,
      "--no-playlist",
      "--no-warnings",
      url,
    ], { timeout: 90_000 });

    const stat = await fs.stat(filePath);
    if (!stat.size) throw new Error("ملف الصوت فارغ");
    return filePath;
  } catch (err) {
    await cleanTemp(filePath);
    throw new Error(`فشل التحميل: ${err.message?.substring(0, 200) || "yt-dlp error"}`);
  }
}

async function sendTrack(api, threadID, messageID, track, listMsgId = null) {
  let filePath = null;
  try {
    filePath = await downloadToTemp(track.videoId);
    await global.mediaSendFile(api, filePath, threadID, messageID);
    if (listMsgId) { try { await api.unsendMessage(listMsgId, threadID); } catch (_) {} }
  } finally {
    if (filePath) await cleanTemp(filePath);
  }
}

// ─── قائمة الاختيار بالتفاعل ────────────────────────────────────
function fmtDuration(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function showTrackList(api, event, list) {
  const { threadID, messageID } = event;
  const line = "─".repeat(22);
  let text = `🎵 نتائج البحث في YouTube Music:\n${line}\n`;
  list.forEach((t, i) => {
    text += `${TRACK_EMOJIS[i]} ${t.title || "بدون عنوان"}\n`;
    text += `   👤 ${t.artist || ""} ${fmtDuration(t.duration)}\n${line}\n`;
  });
  text += "تفاعل بالإيموجي لاختيار الأغنية\n⏳ تنتهي بعد دقيقتين";

  const sent = await new Promise((res, rej) =>
    global.safeSend(api, text, threadID, (err, info) => (err ? rej(err) : res(info)), messageID)
  );
  const listeners = global.client?.reactionListener;
  if (!sent?.messageID || !listeners) return;

  listeners[sent.messageID] = {
    author: event.senderID,
    callback: async ({ api, event: re }) => {
      const idx = TRACK_EMOJIS.indexOf(re.reaction);
      if (idx === -1 || idx >= list.length) return;
      delete listeners[sent.messageID];
      await sendTrack(api, threadID, messageID, list[idx], sent.messageID);
    },
  };
  setTimeout(() => delete listeners[sent.messageID], LIST_TTL_MS);
}

export default {
  config: {
    name:        "song",
    aliases:     ["موسيقى"],
    version:     "2.0.0",
    role:        0,
    countDown:   0,
    category: "وسائط وتحميل",
    description: "بحث وتشغيل مقاطع من YouTube Music — أضف s لعرض قائمة نتائج",
    usage: [
      "{pn}song <اسم> — تشغيل أول نتيجة مباشرة",
      "{pn}song s <اسم> — عرض قائمة نتائج للاختيار",
      "{pn}موسيقى <اسم> — نفس الأمر بالعربية",
    ],
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;
    if (!args[0]) return message.reply(HELP);

    const showList = args[0].toLowerCase() === "s";
    const query = (showList ? args.slice(1) : args).join(" ").trim();
    if (!query) return message.reply("❌ أرسل اسم الأغنية.");

    try {
      const tracks = await searchTracks(query, showList ? LIST_SIZE : 1);
      if (showList) await showTrackList(api, event, tracks);
      else await sendTrack(api, threadID, messageID, tracks[0]);
    } catch (err) {
      console.error("[yt-music] خطأ:", err.message);
      global.safeSend(api, `❌ ${err.message?.substring(0, 200) || "خطأ غير معروف"}`, threadID, null, messageID);
    }
  },
};   
