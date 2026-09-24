"use strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import http from "./fetchHttp.js";
import * as cache from "./cache.js";
async function getYtScraper() { return await import("@vreden/youtube_scraper"); }
async function getYouTube()   { return (await import("youtube-sr")).YouTube; }
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function extractYoutubeVideoId(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const isYoutubeHost = host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com" ||
                         host === "music.youtube.com" || host === "gaming.youtube.com";
  if (host === "youtu.be") {
    return u.pathname.split("/").filter(Boolean)[0] || null;
  }
  if (!isYoutubeHost) return null;
  const vParam = u.searchParams.get("v");
  if (vParam) return vParam;
  const parts = u.pathname.split("/").filter(Boolean);
  const markerIdx = parts.findIndex(p => ["shorts", "embed", "live", "v"].includes(p));
  if (markerIdx !== -1 && parts[markerIdx + 1]) return parts[markerIdx + 1];
  return null;
}
function normalizeYoutubeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  const trimmed = rawUrl.trim();
  const videoId = extractYoutubeVideoId(trimmed);
  if (!videoId) return trimmed;
  return `https://www.youtube.com/watch?v=${videoId}`;
}
function fmtDur(sec) {
  if (!sec) return "--";
  const m = Math.floor(sec / 60), s = sec % 60, h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`
           : `${m}:${String(s).padStart(2, "0")}`;
}
async function streamToFile(url, destPath) {
  const response = await http.get(url, {
    responseType: "stream",
    timeout: 5 * 60 * 1000,
    headers: { "User-Agent": USER_AGENT },
  });
  const writer = fs.createWriteStream(destPath);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
  const stat = await fs.stat(destPath);
  if (!stat.size) throw new Error("الملف المُنزَّل فارغ");
}
async function searchVideos(query, limit = 10) {
  const cacheKey = `yt_search:${query.toLowerCase()}:${limit}`;
  const cached   = cache.get(cacheKey);
  if (cached) return cached;
  const YouTube = await getYouTube();
  const found = await YouTube.search(query, { limit, type: "video", safeSearch: false });
  if (!found?.length) throw new Error("لا توجد نتائج");
  const results = found.slice(0, limit).map(v => ({
    id:       v.id || "",
    title:    v.title || "بدون عنوان",
    url:      v.url || `https://www.youtube.com/watch?v=${v.id}`,
    duration: v.durationFormatted || fmtDur(Math.floor((v.duration || 0) / 1000)) || "--",
    uploader: v.channel?.name || "",
    thumb:    v.thumbnail?.url || "",
  }));
  cache.set(cacheKey, results, 5 * 60 * 1000);
  return results;
}
async function downloadAudio(ytUrl) {
  const ytScraper = await getYtScraper();
  const data = await ytScraper.ytmp3(normalizeYoutubeUrl(ytUrl), 128);
  if (!data.status || !data.download?.url) throw new Error(data.message || "فشل استخراج رابط الصوت");
  const meta     = data.metadata || {};
  const filePath = path.join(os.tmpdir(), `yt_a_${Date.now()}.mp3`);
  await streamToFile(data.download.url, filePath);
  return {
    filePath,
    title:    meta.title || "audio",
    duration: meta.seconds || 0,
    uploader: meta.author?.name || meta.channel || "",
  };
}
async function downloadVideo(ytUrl) {
  const ytScraper = await getYtScraper();
  const data = await ytScraper.ytmp4(normalizeYoutubeUrl(ytUrl), 360);
  if (!data.status || !data.download?.url) throw new Error(data.message || "فشل استخراج رابط الفيديو");
  const meta     = data.metadata || {};
  const filePath = path.join(os.tmpdir(), `yt_v_${Date.now()}.mp4`);
  await streamToFile(data.download.url, filePath);
  return {
    filePath,
    title:    meta.title || "video",
    duration: meta.seconds || 0,
    uploader: meta.author?.name || meta.channel || "",
  };
}
export { searchVideos, downloadAudio, downloadVideo, fmtDur, streamToFile, normalizeYoutubeUrl };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-utils-yt-engine',
  meta: { category: 'utils', path: 'src/utils/ytEngine.js' },
  setup(_ctx) {
    // provides: downloadAudio, downloadVideo, fmtDur, normalizeYoutubeUrl, searchVideos, streamToFile
  },
};
