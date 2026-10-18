import fs from "fs-extra";
import os from "os";
import path from "path";
import vreden from "@vreden/youtube_scraper";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import http from "./fetchHttp.js";
import { cache } from "./system.js";
async function downloadToTempFile(url, prefix, ext, { timeout = 120000, userAgent = "Mozilla/5.0" } = {}) {
  const filePath = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${randomUUID()}.${ext}`);
  try {
    const response = await http.get(url, {
      responseType: "stream",
      timeout,
      headers: { Accept: "video/mp4,audio/mpeg,*/*", "User-Agent": userAgent },
    });
    await pipeline(response.data, fs.createWriteStream(filePath));
    if (!(await fs.stat(filePath)).size) throw new Error("الملف المُنزَّل فارغ");
    return filePath;
  } catch (error) {
    await fs.remove(filePath).catch(() => {});
    throw error;
  }
}
const YOZORA_BASE_URL = "https://yozora.vercel.app";
const YOZORA_DEFAULT_FORMAT = "bestvideo+bestaudio/best";
function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}
function firstEntry(info) {
  if (!info || typeof info !== "object") return null;
  if (Array.isArray(info.entries)) return info.entries.find(Boolean) || null;
  return info;
}
function buildYozoraUrl(pathname, params = {}) {
  const url = new URL(pathname, YOZORA_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
async function getYozoraInfo(query, format = YOZORA_DEFAULT_FORMAT, timeout = 90_000) {
  const source = asText(query);
  if (!source) throw new Error("رابط أو عبارة البحث فارغة");
  const response = await http.get(buildYozoraUrl("/api/info", {
    query: source,
    format,
  }), {
    timeout,
    responseType: "json",
    validateStatus: () => true,
    headers: { Accept: "application/json", "User-Agent": "SunkenBot/3.0" },
  });
  if (response.status < 200 || response.status >= 300) {
    const detail = typeof response.data === "string"
      ? response.data
      : response.data?.detail || response.data?.message;
    throw new Error(`Yozora رفض الطلب (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
  }
  if (!response.data || typeof response.data !== "object") {
    throw new Error("استجابة غير صالحة من Yozora");
  }
  return response.data;
}
function normalizeYozoraEntry(entry, index = 0) {
  const item = entry && typeof entry === "object" ? entry : {};
  const id = asText(item.id) || asText(item.display_id) || `yozora-${index}`;
  const title = asText(item.title) || "بدون عنوان";
  const webpageUrl = asText(item.webpage_url) || asText(item.original_url) || asText(item.url);
  const durationSeconds = Number(item.duration) || 0;
  const duration = durationSeconds > 0
    ? `${Math.floor(durationSeconds / 60)}:${String(Math.floor(durationSeconds % 60)).padStart(2, "0")}`
    : "--";
  return {
    id,
    title,
    url: webpageUrl,
    duration,
    uploader: asText(item.uploader) || asText(item.channel) || asText(item.uploader_id),
    thumb: asText(item.thumbnail),
  };
}
function getYozoraEntries(info, limit = 10) {
  const entries = Array.isArray(info?.entries) ? info.entries : [info];
  return entries.filter(Boolean).slice(0, limit).map(normalizeYozoraEntry);
}
function getYozoraTitle(info, fallback = "وسائط") {
  const item = firstEntry(info);
  return asText(item?.title) || fallback;
}
function buildYozoraDownloadUrl(source, format = YOZORA_DEFAULT_FORMAT) {
  return buildYozoraUrl("/api/download", { url: source, format });
}
const XALMAN_BASE = (process.env.XALMAN_API_BASE_URL || "https://xalman-apis.vercel.app").replace(/\/+$/, "");
function directUrl(payload) {
  return payload?.url || payload?.data?.url || payload?.result?.url || payload?.download?.url || null;
}
function titleOf(payload, fallback = "YouTube media") {
  return payload?.title || payload?.data?.title || payload?.result?.title || payload?.filename || fallback;
}
async function downloadFromXalman(url, wantMp4 = false) {
  const endpoint = wantMp4 ? "/api/ytdl" : "/api/ytmp3";
  const response = await http.get(`${XALMAN_BASE}${endpoint}`, {
    params: { url: String(url) },
    timeout: 120000,
  });
  const payload = response.data;
  const mediaUrl = directUrl(payload);
  if (!mediaUrl) throw new Error(`Xalman لم يُرجع رابط تنزيل من ${endpoint}`);
  const filePath = await downloadToTempFile(mediaUrl, "xalman_yt", wantMp4 ? "mp4" : "mp3", { userAgent: "SunkenBot/4.0" });
  return { filePath, title: titleOf(payload), duration: 0, uploader: "" };
}
function extractYoutubeVideoId(raw) {
    let u;
    try { u = new URL(raw); } catch { return null; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const youtubeHosts = new Set(["youtube.com", "youtube-nocookie.com", "m.youtube.com", "music.youtube.com", "gaming.youtube.com"]);
    if (host === "youtu.be") return u.pathname.split("/").filter(Boolean)[0] || null;
    if (!youtubeHosts.has(host)) return null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const parts = u.pathname.split("/").filter(Boolean);
    const marker = parts.findIndex(part => ["shorts", "embed", "live", "v"].includes(part));
    return marker >= 0 ? parts[marker + 1] || null : null;
}
function normalizeYoutubeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
    const id = extractYoutubeVideoId(rawUrl.trim());
    return id ? `https://www.youtube.com/watch?v=${id}` : rawUrl.trim();
}
async function searchVideos(query, limit = 10) {
    const cacheKey = `yt_search:yozora:${query.toLowerCase()}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const info = await getYozoraInfo(`ytsearch${Math.max(1, limit)}:${query}`);
    const results = getYozoraEntries(info, limit);
    if (!results.length || !results[0].url) throw new Error("لا توجد نتائج");
    cache.set(cacheKey, results, 5 * 60 * 1000);
    return results;
}
async function downloadFromYozora(ytUrl, format, suffix, fallbackTitle) {
    const normalized = normalizeYoutubeUrl(ytUrl);
    const info = await getYozoraInfo(normalized, format);
    const filePath = await downloadToTempFile(buildYozoraDownloadUrl(normalized, format), `yt_${suffix}`, suffix, { timeout: 5 * 60 * 1000, userAgent: "SunkenBot/3.0" });
    return {
        filePath,
        title: getYozoraTitle(info, fallbackTitle),
        duration: Number(info?.duration) || 0,
        uploader: info?.uploader || info?.channel || ""
    };
}
async function downloadAudio(ytUrl) {
    try {
        return await downloadFromXalman(ytUrl, false);
    } catch (error) {
        console.warn(`[YT/audio] Xalman failed, using Yozora fallback: ${error.message}`);
        return downloadFromYozora(ytUrl, "bestaudio/best", "mp3", "audio");
    }
}
async function downloadVideo(ytUrl) {
    try {
        return await downloadFromXalman(ytUrl, true);
    } catch (error) {
        console.warn(`[YT/video] Xalman failed, using Yozora fallback: ${error.message}`);
        return downloadFromYozora(ytUrl, "bestvideo+bestaudio/best", "mp4", "video");
    }
}
const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 100;
const searchCache = new Map();
const pendingSearches = new Map();
function cloneResults(results) {
  return results.map(result => ({ ...result }));
}
function readSearchCache(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }
  searchCache.delete(key);
  searchCache.set(key, entry);
  return cloneResults(entry.results);
}
function writeSearchCache(key, results) {
  if (searchCache.size >= MAX_SEARCH_CACHE_ENTRIES) {
    searchCache.delete(searchCache.keys().next().value);
  }
  searchCache.set(key, {
    results: cloneResults(results),
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });
}
function normalizeSearchResult(item) {
  if (!item || typeof item !== "object") return null;
  const url = item.url || (item.videoId
    ? `https://www.youtube.com/watch?v=${item.videoId}`
    : null);
  if (!url) return null;
  return {
    url,
    title: item.title || item.name || "YouTube video",
    duration: item.duration?.seconds || item.seconds || item.duration || 0,
    uploader: item.author?.name || item.author || item.channel?.name || item.channel || "",
    thumbnail: item.thumbnail || item.image || item.bestThumbnail?.url || null,
    views: item.views || item.viewCount || 0,
  };
}
const vredenProvider = {
  name: "vreden-youtube-scraper",
  async search(query, limit = 10) {
    const result = await vreden.search(query);
    if (!result?.status || !Array.isArray(result.results)) {
      throw new Error(result?.message || "لا توجد نتائج من Vreden");
    }
    const items = result.results.map(normalizeSearchResult).filter(Boolean).slice(0, limit);
    if (!items.length) throw new Error("لا توجد نتائج");
    return items;
  },
  async download(url, wantMp4) {
    const result = wantMp4
      ? await vreden.ytmp4(url, 360)
      : await vreden.ytmp3(url, 128);
    if (!result?.status || !result.download?.url) {
      throw new Error(result?.message || "لم يُرجع Vreden رابط تحميل");
    }
    const metadata = result.metadata || {};
    const filePath = await downloadToTempFile(
      result.download.url,
      "vreden-yt",
      wantMp4 ? "mp4" : "mp3",
    );
    return {
      filePath,
      title: metadata.title || result.download.filename || "YouTube media",
      duration: metadata.seconds || metadata.duration || 0,
      uploader: metadata.author?.name || metadata.author || "",
    };
  },
};
const YT_DLP_STREAM_BASE = "https://yt-dlp-stream.onrender.com/api";
function parseYtDlpStreamResult(data) {
  if (!data || typeof data !== "object") {
    return { title: "بدون عنوان", author: "", mp4Url: null, mp3Url: null };
  }
  const media = data.media && typeof data.media === "object" && !Array.isArray(data.media)
    ? data.media
    : {};
  const getUrl = value => typeof value === "string"
    ? value
    : value && typeof value.url === "string" ? value.url : null;
  return {
    title: data.title || "بدون عنوان",
    author: data.author || data.channel || "",
    mp4Url: getUrl(media.mp4) || getUrl(data.mp4),
    mp3Url: getUrl(media.mp3) || getUrl(data.mp3),
  };
}
const ytDlpStreamProvider = {
  name: "yt-dlp-stream",
  async search(query, limit) {
    const url = `${YT_DLP_STREAM_BASE}/v3/q?query=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await http.get(url, { timeout: 25000 });
    const data = res.data;
    const list = Array.isArray(data) ? data
      : Array.isArray(data?.results) ? data.results
      : Array.isArray(data?.data) ? data.data
      : [];
    if (!list.length) throw new Error("لا توجد نتائج");
    return list.map(item => normalizeSearchResult(item)).filter(Boolean);
  },
  async download(url, wantMp4) {
    const res = await http.get(`${YT_DLP_STREAM_BASE}/v2/q`, {
      params: { url },
      timeout: 30000,
    });
    const raw = Array.isArray(res.data) ? res.data[0] : res.data;
    const parsed = parseYtDlpStreamResult(raw || {});
    const mediaUrl = wantMp4 ? parsed.mp4Url : parsed.mp3Url;
    if (!mediaUrl) throw new Error("الرابط غير متاح عبر هذا المزوّد");
    const filePath = await downloadToTempFile(mediaUrl, "yt-dlp", wantMp4 ? "mp4" : "mp3");
    return { filePath, title: parsed.title, duration: 0, uploader: parsed.author };
  },
};
const xalmanProvider = {
  name: "xalman-api",
  async download(url, wantMp4) {
    return downloadFromXalman(url, wantMp4);
  },
};
const providers = [xalmanProvider, vredenProvider, ytDlpStreamProvider];
async function searchWithFallback(query, limit = 10) {
  const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ").toLowerCase();
  const normalizedLimit = Math.max(1, Number(limit) || 10);
  const cacheKey = `${normalizedLimit}:${normalizedQuery}`;
  const cached = readSearchCache(cacheKey);
  if (cached) return cached;
  if (pendingSearches.has(cacheKey)) return cloneResults(await pendingSearches.get(cacheKey));
  const pending = (async () => {
    const errors = [];
    for (const provider of providers) {
      if (typeof provider.search !== "function") continue;
      try {
        const results = await provider.search(query, limit);
        if (Array.isArray(results) && results.length) writeSearchCache(cacheKey, results);
        return results;
      } catch (error) {
        errors.push(`${provider.name}: ${error.message}`);
      }
    }
    throw new Error(errors.join(" | ") || "تعذّر البحث عبر جميع المزوّدين");
  })();
  pendingSearches.set(cacheKey, pending);
  try {
    return cloneResults(await pending);
  } finally {
    if (pendingSearches.get(cacheKey) === pending) pendingSearches.delete(cacheKey);
  }
}
const HEDGE_MS = Math.max(500, Number.parseInt(process.env.YT_HEDGE_MS || "", 10) || 4000);
function downloadWithFallback(url, wantMp4) {
  return new Promise((resolve, reject) => {
    const errors = [];
    const started = new Set();
    const timers = new Set();
    let settled = false;
    let failed = 0;
    const start = (i) => {
      if (settled || i >= providers.length || started.has(i)) return;
      started.add(i);
      const provider = providers[i];
      if (i + 1 < providers.length) {
        const t = setTimeout(() => { timers.delete(t); start(i + 1); }, HEDGE_MS);
        timers.add(t);
      }
      Promise.resolve()
        .then(() => provider.download(url, wantMp4))
        .then(async (result) => {
          if (settled) { await cleanTemp(result?.filePath); return; }
          settled = true;
          timers.forEach(clearTimeout);
          resolve({ ...result, provider: provider.name });
        })
        .catch((error) => {
          errors.push(`${provider.name}: ${error?.message || error}`);
          failed++;
          if (settled) return;
          start(i + 1);
          if (failed === providers.length) {
            timers.forEach(clearTimeout);
            settled = true;
            reject(new Error(errors.join(" | ") || "تعذّر التحميل عبر جميع المزوّدين"));
          }
        });
    };
    start(0);
  });
}
async function cleanTemp(filePath) {
  try {
    if (filePath && await fs.pathExists(filePath)) await fs.remove(filePath);
  } catch (_) {}
}
export {
  searchVideos, downloadAudio, downloadVideo,
  searchWithFallback, downloadWithFallback, cleanTemp,
  getYozoraInfo, getYozoraEntries, buildYozoraDownloadUrl,
};
