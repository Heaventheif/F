"use strict";
import http from "../utils/fetchHttp.js";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Innertube } from "youtubei.js";

// ─── الإعدادات (من متغيرات البيئة — Render → Environment) ────────
// API_URL مثال: https://my-api.onrender.com  (بدون / في النهاية)
export function getApiUrl() {
  const url = (process.env.API_URL || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url))
    throw new Error("متغير البيئة API_URL غير مضبوط أو غير صالح");
  return url;
}

export const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const RETRY_STATUS = new Set([502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** يقرأ رسالة الخطأ من جسم استجابة stream (JSON من الـ API) */
export async function streamErrorMessage(res) {
  try {
    const chunks = [];
    let size = 0;
    for await (const c of res.data) {
      chunks.push(c);
      if ((size += c.length) > 8192) break;
    }
    res.data.destroy?.();
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return body?.error?.message || body?.message || null;
  } catch {
    return null;
  }
}

/**
 * ينزّل الصوت من الـ API إلى ملف مؤقت.
 * يعيد المحاولة عند 502/503/504 أو أخطاء الشبكة (السيرفر المجاني على Render
 * يحتاج وقتًا ليستيقظ عند أول طلب).
 * @param {string} sourceUrl رابط المقطع (YouTube / SoundCloud ...)
 * @param {"mp3"|"m4a"} format
 * @returns {Promise<string>} مسار الملف المؤقت
 */
export async function downloadAudio(sourceUrl, format = "mp3", attempts = 3) {
  const apiUrl = getApiUrl();
  const filePath = path.join(os.tmpdir(), `au_${Date.now()}_${randomUUID()}.${format}`);
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await http.get(`${apiUrl}/api/v1/audio`, {
        params: { url: sourceUrl, format },
        responseType: "stream",
        headers: BROWSER_HEADERS,
        timeout: 180_000,
      });
      if (res.status >= 400) {
        const msg = (await streamErrorMessage(res)) || `HTTP ${res.status}`;
        const err = new Error(`فشل التنزيل: ${msg}`);
        err.status = res.status;
        throw err;
      }
      await pipeline(res.data, fs.createWriteStream(filePath));
      if (!(await fs.stat(filePath)).size) throw new Error("ملف الصوت فارغ");
      return filePath;
    } catch (err) {
      lastErr = err;
      await fs.remove(filePath).catch(() => {});
      const status = err.status || err.response?.status;
      const retryable = RETRY_STATUS.has(status) || (!status && err.code !== undefined);
      if (!retryable || i === attempts) break;
      await sleep(4000 * i);
    }
  }
  throw lastErr;
}

// نسخة Innertube واحدة تُعاد استخدامها (إنشاؤها مكلف)
let ytPromise = null;
function getYT() {
  if (!ytPromise) {
    ytPromise = Innertube.create({ lang: "en", location: "US" }).catch((err) => {
      ytPromise = null; // أعد المحاولة في الطلب التالي
      throw err;
    });
  }
  return ytPromise;
}

/**
 * بحث في YouTube Music عبر youtubei.js
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<{id:string,videoId:string,title:string,artists:string,duration:number|null,thumbnail:string|null}>>}
 */
export async function search(query, limit = 1) {
  const yt = await getYT();
  const res = await yt.music.search(String(query || "").trim(), { type: "song" });
  const items = (res.songs?.contents ?? []).filter((x) => x?.id);
  if (!items.length) throw new Error("no_results");
  return items.slice(0, limit).map((x) => ({
    id: x.id,
    videoId: x.id,
    title: x.title || "",
    artists: (x.artists || []).map((a) => a.name).join(", "),
    duration: x.duration?.seconds ?? null,
    thumbnail: x.thumbnails?.[0]?.url ?? null,
  }));
}

/**
 * تحميل مقطع من YouTube Music وإعادته كـ filePath (M4A)
 * @param {string} videoId
 * @returns {Promise<string>} مسار الملف المؤقت
 */
export async function download(videoId) {
  if (!/^[\w-]{11}$/.test(String(videoId || "")))
    throw new Error("معرّف فيديو غير صالح");
  return downloadAudio(`https://music.youtube.com/watch?v=${videoId}`, "m4a");
}
