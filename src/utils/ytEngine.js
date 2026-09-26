import fs from "fs-extra";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import http from "./fetchHttp.js";
import { getYozoraInfo, getYozoraEntries, getYozoraTitle, buildYozoraDownloadUrl } from "./yozora.js";
import * as cache from "./cache.js";

export function extractYoutubeVideoId(raw) {
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

export function normalizeYoutubeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
    const id = extractYoutubeVideoId(rawUrl.trim());
    return id ? `https://www.youtube.com/watch?v=${id}` : rawUrl.trim();
}

function fmtDur(sec) {
    if (!sec) return "--";
    const total = Math.floor(Number(sec));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function streamToFile(url, destPath) {
    const response = await http.get(url, {
        responseType: "stream",
        timeout: 5 * 60 * 1000,
        headers: { Accept: "video/mp4,audio/mpeg,*/*", "User-Agent": "SunkenBot/3.0" }
    });
    try {
        await pipeline(response.data, fs.createWriteStream(destPath));
        if (!(await fs.stat(destPath)).size) throw new Error("الملف المُنزَّل فارغ");
    } catch (error) {
        await fs.remove(destPath).catch(() => {});
        throw error;
    }
}

export async function searchVideos(query, limit = 10) {
    const cacheKey = `yt_search:yozora:${query.toLowerCase()}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const info = await getYozoraInfo(`ytsearch${Math.max(1, limit)}:${query}`);
    const results = getYozoraEntries(info, limit).map(item => ({
        ...item,
        duration: item.duration || fmtDur(0)
    }));
    if (!results.length || !results[0].url) throw new Error("لا توجد نتائج");
    cache.set(cacheKey, results, 5 * 60 * 1000);
    return results;
}

async function downloadFromYozora(ytUrl, format, suffix, fallbackTitle) {
    const normalized = normalizeYoutubeUrl(ytUrl);
    const info = await getYozoraInfo(normalized, format);
    const filePath = path.join(os.tmpdir(), `yt_${suffix}_${Date.now()}_${randomUUID()}.${suffix}`);
    await streamToFile(buildYozoraDownloadUrl(normalized, format), filePath);
    return {
        filePath,
        title: getYozoraTitle(info, fallbackTitle),
        duration: Number(info?.duration) || 0,
        uploader: info?.uploader || info?.channel || ""
    };
}

export async function downloadAudio(ytUrl) {
    return downloadFromYozora(ytUrl, "bestaudio/best", "mp3", "audio");
}

export async function downloadVideo(ytUrl) {
    return downloadFromYozora(ytUrl, "bestvideo+bestaudio/best", "mp4", "video");
}

export { fmtDur, streamToFile };

export const $plugin = {
    name: "xx-utils-yt-engine",
    meta: { category: "utils", path: "src/utils/ytEngine.js" },
    setup(_ctx) {}
};
