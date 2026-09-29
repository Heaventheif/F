"use strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import http from "./fetchHttp.js";
import vreden from "@vreden/youtube_scraper";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";

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

async function streamToTempFile(url, prefix, ext) {
  const filePath = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${randomUUID()}.${ext}`);
  try {
    const response = await http.get(url, {
      responseType: "stream",
      timeout: 120000,
      headers: { Accept: "video/mp4,audio/mpeg,*/*", "User-Agent": "Mozilla/5.0" },
    });
    await pipeline(response.data, fs.createWriteStream(filePath));
    const stat = await fs.stat(filePath);
    if (stat.size === 0) throw new Error("الملف فارغ.");
    return filePath;
  } catch (error) {
    await fs.remove(filePath).catch(() => {});
    throw error;
  }
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
    const filePath = await streamToTempFile(
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
    const filePath = await streamToTempFile(mediaUrl, "yt-dlp", wantMp4 ? "mp4" : "mp3");
    return { filePath, title: parsed.title, duration: 0, uploader: parsed.author };
  },
};

const providers = [vredenProvider, ytDlpStreamProvider];

export { providers };

export async function searchWithFallback(query, limit = 10) {
  const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ").toLowerCase();
  const normalizedLimit = Math.max(1, Number(limit) || 10);
  const cacheKey = `${normalizedLimit}:${normalizedQuery}`;
  const cached = readSearchCache(cacheKey);
  if (cached) return cached;
  if (pendingSearches.has(cacheKey)) return cloneResults(await pendingSearches.get(cacheKey));

  const pending = (async () => {
    const errors = [];
    for (const provider of providers) {
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

export async function downloadWithFallback(url, wantMp4) {
  const errors = [];
  for (const provider of providers) {
    try {
      const result = await provider.download(url, wantMp4);
      return { ...result, provider: provider.name };
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
    }
  }
  throw new Error(errors.join(" | ") || "تعذّر التحميل عبر جميع المزوّدين");
}

export async function cleanTemp(filePath) {
  try {
    if (filePath && await fs.pathExists(filePath)) await fs.remove(filePath);
  } catch (_) {}
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-utils-yt-providers",
  meta: { category: "utils", path: "src/utils/ytProviders.js" },
  setup(_ctx) {
    // provides: cleanTemp, downloadWithFallback, providers, searchWithFallback
  },
};
