"use strict";
import http from "../src/utils/fetchHttp.js";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};
const TRACK_EMOJIS = ["👍", "❤️", "😆", "😮", "😢", "😡", "🥰", "🤩"];
const LIST_SIZE = 7;
const LIST_TTL_MS = 120_000;
const CLIENT_ID_TTL_MS = 12 * 60 * 60 * 1000;
const HELP =
  "🎵 SoundCloud\n\n" +
  "song <اسم الأغنية>      — تشغيل أول نتيجة مباشرة\n" +
  "song s <اسم الأغنية>    — عرض قائمة للاختيار\n" +
  "(أو موسيقى بدل song)\n\n" +
  "مثال:\n" +
  "song after the dark mr kitty\n" +
  "song s mr kitty";
const isStale = (err) => [401, 404].includes(err?.response?.status);
const cleanTemp = (p) => fs.remove(p).catch(() => {});
let _clientId = null;
let _clientExp = 0;
async function fetchClientId() {
  const page = await http.get("https://soundcloud.com", { headers: BROWSER_HEADERS, timeout: 15000 });
  const scriptUrls = [...page.data.matchAll(/https:\/\/a-v2\.sndcdn\.com\/[^"]+\.js/g)].map(m => m[0]);
  if (!scriptUrls.length) throw new Error("لم تُوجد سكريبتات SoundCloud");
  for (const url of scriptUrls.slice(-8).reverse()) {
    try {
      const { data } = await http.get(url, { headers: BROWSER_HEADERS, timeout: 10000 });
      const match =
        data.match(/[{,]client_id:"([a-zA-Z0-9]{20,40})"/) ||
        data.match(/"client_id"\s*:\s*"([a-zA-Z0-9]{20,40})"/) ||
        data.match(/client_id\s*=\s*"([a-zA-Z0-9]{20,40})"/);
      if (match) return match[1];
    } catch (_) {}
  }
  throw new Error("فشل استخراج client_id من SoundCloud");
}
async function getClientId(forceRefresh = false) {
  if (!forceRefresh && _clientId && Date.now() < _clientExp) return _clientId;
  _clientId = await fetchClientId();
  _clientExp = Date.now() + CLIENT_ID_TTL_MS;
  return _clientId;
}
getClientId().catch(() => {});
async function searchTracks(query, limit) {
  const doSearch = async (forceRefresh) => {
    const client_id = await getClientId(forceRefresh);
    const res = await http.get("https://api-v2.soundcloud.com/search/tracks", {
      params: {
        q: query, client_id, limit,
        offset: 0, linked_partitioning: 1,
        app_version: "1733219585", app_locale: "en",
      },
      headers: BROWSER_HEADERS,
      timeout: 15000,
    });
    const tracks = (Array.isArray(res.data?.collection) ? res.data.collection : [])
      .filter(t => t && typeof t === "object");
    if (!tracks.length) throw new Error("لم تُوجد نتائج على SoundCloud");
    return tracks;
  };
  try {
    return await doSearch(false);
  } catch (err) {
    if (isStale(err)) return doSearch(true);
    throw err;
  }
}
async function resolveStreamUrl(transcodingUrl, trackAuthorization, forceRefresh) {
  const client_id = await getClientId(forceRefresh);
  const res = await http.get(transcodingUrl, {
    params: { client_id, track_authorization: trackAuthorization },
    headers: BROWSER_HEADERS,
    timeout: 15000,
  });
  if (!res.data?.url) throw new Error("فشل استخراج رابط البث");
  return res.data.url;
}
async function downloadToTemp(streamUrl) {
  const filePath = path.join(os.tmpdir(), `sc_${Date.now()}_${randomUUID()}.mp3`);
  try {
    const res = await http.get(streamUrl, { responseType: "stream", headers: BROWSER_HEADERS, timeout: 60000 });
    await pipeline(res.data, fs.createWriteStream(filePath));
    if (!(await fs.stat(filePath)).size) throw new Error("ملف الصوت فارغ");
    return filePath;
  } catch (err) {
    await cleanTemp(filePath);
    throw err;
  }
}
const RANK = { progressive: [0, 2], hls: [1, 3] };
const rank = (t) => RANK[t.format?.protocol]?.[t.snipped ? 1 : 0] ?? 4;
async function streamTrack(track) {
  const transcodings = Array.isArray(track?.media?.transcodings) ? track.media.transcodings : [];
  const byUrl = new Map(transcodings.filter(t => t && t.url).map(t => [t.url, t]));
  const candidates = [...byUrl.values()].sort((a, b) => rank(a) - rank(b));
  if (!candidates.length) throw new Error("لا يوجد بث متاح لهذا المقطع");
  const trackAuth = track?.track_authorization ?? "";
  const errors = [];
  for (const pick of candidates) {
    for (const refresh of [false, true]) {
      try {
        return await downloadToTemp(await resolveStreamUrl(pick.url, trackAuth, refresh));
      } catch (err) {
        errors.push(`${pick.format?.protocol}: ${err.message}`);
        if (!isStale(err)) break;
      }
    }
  }
  throw new Error("فشل تشغيل المقطع: " + errors.slice(-3).join(" | "));
}
const stage = async (name, fn) => {
  try { return await fn(); }
  catch (err) {
    if (err && typeof err === "object" && !err.stage) err.stage = name;
    throw err;
  }
};
async function sendTrack(api, threadID, messageID, track, listMsgId = null) {
  let filePath = null;
  try {
    filePath = await stage("download", () => streamTrack(track));
    await stage("send", () => global.mediaSendFile(api, filePath, threadID, messageID));
    if (listMsgId) { try { await api.unsendMessage(listMsgId, threadID); } catch (_) {} }
  } finally {
    if (filePath) await cleanTemp(filePath);
  }
}
function fmtDuration(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
async function showTrackList(api, event, list) {
  const { threadID, messageID } = event;
  const line = "─".repeat(22);
  let text = `🎵 نتائج البحث في SoundCloud:\n${line}\n`;
  list.forEach((t, i) => {
    text += `${TRACK_EMOJIS[i]} ${t.title || "بدون عنوان"}\n`;
    text += `   👤 ${t.user?.username || ""} ${fmtDuration(t.full_duration || t.duration)}\n${line}\n`;
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
    version:     "1.0.0",
    role:        0,
    countDown:   0,
    category: "وسائط وتحميل",
    description: "بحث وتشغيل مقاطع من SoundCloud — أضف s لعرض قائمة نتائج",
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
      const tracks = await stage("search", () => searchTracks(query, showList ? LIST_SIZE : 1));
      if (showList) await stage("list", () => showTrackList(api, event, tracks.slice(0, LIST_SIZE)));
      else await sendTrack(api, threadID, messageID, tracks[0]);
    } catch (err) {
      const msg = String(err?.message ?? err?.error ?? err ?? "").trim();
      console.error(`[sc] خطأ (${err?.stage || "?"}):`, err?.stack || msg);
      global.safeSend(api, `❌ ${msg.substring(0, 200) || "خطأ غير معروف"}`, threadID, null, messageID);
    }
  },
};
