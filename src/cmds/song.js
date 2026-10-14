"use strict";
import http from "../utils/fetchHttp.js";
import fs from "fs-extra";
import os from "os";
import path from "path";
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};
const TRACK_EMOJIS = ["👍", "❤️","😆","😮","😢", "😡","🥰","🤩"];
let _clientId  = null;
let _clientExp = 0;
let _refreshing = false;
async function fetchClientId() {
  const page = await http.get("https://soundcloud.com", {
    headers: BROWSER_HEADERS,
    timeout: 15000,
  });
  const scriptUrls = [
    ...page.data.matchAll(/https:\/\/a-v2\.sndcdn\.com\/[^"]+\.js/g),
  ].map(m => m[0]);
  if (!scriptUrls.length) throw new Error("لم تُوجد سكريبتات SoundCloud");
  // Start from the last scripts — main SC bundle (containing client_id) loads last
  for (const url of scriptUrls.slice(-8).reverse()) {
    try {
      const script = await http.get(url, { headers: BROWSER_HEADERS, timeout: 10000 });
      // Try multiple regex patterns to handle SoundCloud bundle format changes
      const match =
        script.data.match(/[{,]client_id:"([a-zA-Z0-9]{20,40})"/) ||
        script.data.match(/"client_id"\s*:\s*"([a-zA-Z0-9]{20,40})"/) ||
        script.data.match(/client_id\s*=\s*"([a-zA-Z0-9]{20,40})"/);
      if (match) return match[1];
    } catch (_) {}
  }
  throw new Error("فشل استخراج client_id من SoundCloud");
}
// Get a cached SoundCloud client ID, refreshing it if needed.
// Pass forceRefresh=true to bypass the cache (e.g. after a 404 from the API).
async function getClientId(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _clientId && now < _clientExp) return _clientId;
  if (!forceRefresh && _clientId && now < _clientExp + 60 * 60 * 1000 && !_refreshing) {
    _refreshing = true;
    fetchClientId()
      .then(id => { _clientId = id; _clientExp = Date.now() + 12 * 60 * 60 * 1000; })
      .catch(() => {})
      .finally(() => { _refreshing = false; });
    return _clientId;
  }
  const id = await fetchClientId();
  _clientId  = id;
  _clientExp = Date.now() + 12 * 60 * 60 * 1000;
  return _clientId;
}
getClientId().catch(() => {});
// Search SoundCloud for tracks matching the query.
// Retries once with a fresh client_id if the API returns 404 (stale ID).
async function searchTracks(query, limit = 7) {
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
    const tracks = res.data?.collection;
    if (!tracks?.length) throw new Error("لم تُوجد نتائج على SoundCloud");
    return tracks;
  };
  try {
    return await doSearch(false);
  } catch (err) {
    if (err?.response?.status === 404 || err?.response?.status === 401) {
      return await doSearch(true);
    }
    throw err;
  }
}
async function resolveStreamUrl(transcodingUrl, trackAuthorization, forceRefresh = false) {
  const client_id = await getClientId(forceRefresh);
  const res = await http.get(transcodingUrl, {
    params: { client_id, track_authorization: trackAuthorization ?? "" },
    headers: BROWSER_HEADERS,
    timeout: 15000,
  });
  const url = res.data?.url;
  if (!url) throw new Error("فشل استخراج رابط البث");
  return url;
}
async function streamTrack(track) {
  const transcodings = track.media?.transcodings ?? [];
  if (!transcodings.length) throw new Error("لا يوجد بث متاح لهذا المقطع");
  const ordered = [
    ...transcodings.filter(t => !t.snipped && t.format?.protocol === "progressive"),
    ...transcodings.filter(t => !t.snipped && t.format?.protocol === "hls"),
    ...transcodings.filter(t =>  t.snipped && t.format?.protocol === "progressive"),
    ...transcodings.filter(t =>  t.snipped && t.format?.protocol === "hls"),
    ...transcodings,
  ];
  const seen = new Set();
  const candidates = ordered.filter(t => t.url && !seen.has(t.url) && seen.add(t.url));
  const trackAuth = track.track_authorization ?? "";
  const lastError = [];
  for (const pick of candidates) {
    for (const forceRefresh of [false, true]) {
      try {
        const streamUrl = await resolveStreamUrl(pick.url, trackAuth, forceRefresh);
        const filePath = path.join(os.tmpdir(), `sc_${Date.now()}.mp3`);
        const dlRes = await http.get(streamUrl, {
          responseType: "stream",
          headers:      BROWSER_HEADERS,
          timeout:      60000,
        });
        await new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(filePath);
          dlRes.data.pipe(writer);
          writer.on("finish", resolve);
          writer.on("error", reject);
        });
        const size = (await fs.stat(filePath)).size;
        if (!size) { await cleanTemp(filePath); throw new Error("ملف الصوت فارغ"); }
        return {
          filePath,
          title:      track.title || "بدون عنوان",
          artist:     track.publisher_metadata?.artist || track.user?.username || "",
          durationMs: track.full_duration || track.duration || 0,
          isSnipped:  !!pick.snipped,
        };
      } catch (err) {
        const is404 = err?.response?.status === 404 || err?.response?.status === 401;
        lastError.push(`${pick.format?.protocol}(refresh=${forceRefresh}): ${err.message}`);
        if (!is404) break; 
      }
    }
  }
  throw new Error("فشل تشغيل المقطع: " + lastError.slice(-3).join(" | "));
}
function fmtDuration(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return `⏱ ${m}:${String(s % 60).padStart(2, "0")}`;
}
async function cleanTemp(p) {
  try { await fs.remove(p); } catch (_) {}
}
async function sendTrack(api, threadID, messageID, track, listMsgId = null) {
  let filePath = null;
  try {
    const result = await streamTrack(track);
    filePath = result.filePath;
    await new Promise((res, rej) =>
      global.safeSend(api, 
        { attachment: fs.createReadStream(filePath) },
        threadID,
        err => err ? rej(err) : res(),
        messageID
      )
    );
    if (listMsgId) { try { await api.unsendMessage(listMsgId, threadID); } catch (_) {} }
  } finally {
    if (filePath) cleanTemp(filePath);
  }
}
export default {
  config: {
    name:        "song",
    aliases:     ["موسيقى"],
    version:     "1.0.0",
    role:        0,
    countDown:   6,
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
    if (!args[0]) return message.reply(
      "🎵 SoundCloud\n\n" +
      "song <اسم الأغنية>      — تشغيل أول نتيجة مباشرة\n" +
      "song s <اسم الأغنية>    — عرض قائمة للاختيار\n" +
      "(أو موسيقى بدل song)\n\n" +
      "مثال:\n" +
      "song after the dark mr kitty\n" +
      "song s mr kitty"
    );
    const showList = args[0].toLowerCase() === "s";
    const query    = (showList ? args.slice(1) : args).join(" ").trim();
    if (!query) return message.reply("❌ أرسل اسم الأغنية.");
    try {
      const tracks = await searchTracks(query, showList ? 7 : 1);
      if (showList) {
        const list = tracks.slice(0, 7);
        let text = `🎵 نتائج البحث في SoundCloud:\n${"─".repeat(22)}\n`;
        list.forEach((t, i) => {
          const dur = t.full_duration || t.duration || 0;
          text += `${TRACK_EMOJIS[i]} ${t.title || "بدون عنوان"}\n`;
          text += `   👤 ${t.user?.username || ""} ${dur ? fmtDuration(dur) : ""}\n`;
          text += `${"─".repeat(22)}\n`;
        });
        text += `تفاعل بالإيموجي لاختيار الأغنية\n⏳ تنتهي بعد دقيقتين`;
        const sent = await new Promise((res, rej) =>
          global.safeSend(api, text, threadID, (err, info) => err ? rej(err) : res(info), messageID)
        );
        if (sent?.messageID && global.client?.reactionListener) {
          global.client.reactionListener[sent.messageID] = {
            author: event.senderID,
            callback: async ({ api, event: re }) => {
              const idx = TRACK_EMOJIS.indexOf(re.reaction);
              if (idx === -1 || idx >= list.length) return;
              delete global.client.reactionListener[sent.messageID];
              await sendTrack(api, threadID, messageID, list[idx], sent.messageID);
            },
          };
          setTimeout(() => {
            delete global.client?.reactionListener?.[sent.messageID];
          }, 120000);
        }
        return;
      }
      await sendTrack(api, threadID, messageID, tracks[0]);
    } catch (err) {
      console.error("[sc] خطأ:", err.message);
      global.safeSend(api, `❌ ${err.message?.substring(0, 200) || "خطأ غير معروف"}`, threadID, null, messageID);
    }
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-media-song',
  meta: { category: 'command-media', path: 'src/commands/media/song.js' },
  setup(_ctx) {
    // see module exports
  },
};
