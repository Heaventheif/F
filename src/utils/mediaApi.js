import fs from "fs-extra";
import os from "os";
import path from "path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

const BASE = "https://ytdlp-api-gukc.onrender.com";
const KEY = process.env.YTDLP_KEY;

export class YtdlpApiError extends Error {
  constructor(status, message) {
    super(message || `YTDLP API: HTTP ${status}`);
    this.name = "YtdlpApiError";
    this.status = status;
  }
}

function filenameFromDisposition(value) {
  const match = String(value || "").match(/filename\*=UTF-8''([^;]+)/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

async function parseError(response) {
  const body = await response.json().catch(() => ({}));
  return body?.error || `Download API: HTTP ${response.status}`;
}

export async function downloadMedia(url, { type = "video", q = 720, dir = os.tmpdir(), filename, onProgress, signal } = {}) {
  if (!url) throw new YtdlpApiError(400, "الرابط مطلوب");
  const query = new URLSearchParams({ url: String(url), type, q: String(q) });
  const headers = KEY?.trim() ? { "X-API-Key": KEY.trim() } : {};
  const response = await fetch(`${BASE}/stream?${query}`, {
    headers,
    signal: signal || AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new YtdlpApiError(response.status, await parseError(response));
  if (!response.body) throw new YtdlpApiError(502, "API لم يُرجع تدفق التنزيل");

  await fs.ensureDir(dir);
  const serverName = filenameFromDisposition(response.headers.get("content-disposition"));
  const ext = type === "audio" ? "mp3" : "mp4";
  const safeName = filename || serverName || `media_${randomUUID()}.${ext}`;
  const filePath = path.join(dir, safeName.replace(/[\\/:*?"<>|]/g, "_"));
  try {
    const total = Number(response.headers.get("content-length")) || null;
    let got = 0;
    const body = Readable.fromWeb(response.body);
    body.on("data", chunk => {
      got += chunk.length;
      if (onProgress) onProgress(got, total);
    });
    await pipeline(body, fs.createWriteStream(filePath));
    const stat = await fs.stat(filePath);
    if (!stat.size) throw new YtdlpApiError(502, "الملف المُنزَّل فارغ");
    return { path: filePath, filePath, bytes: stat.size, title: serverName || "وسائط" };
  } catch (error) {
    await fs.remove(filePath).catch(() => {});
    throw error;
  }
}

export async function info(url) {
  if (!url) throw new YtdlpApiError(400, "الرابط مطلوب");
  const headers = KEY?.trim() ? { "X-API-Key": KEY.trim() } : {};
  const response = await fetch(`${BASE}/info?url=${encodeURIComponent(url)}`, {
    headers,
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new YtdlpApiError(response.status, await parseError(response));
  const data = await response.json();
  if (!data?.ok) throw new YtdlpApiError(response.status, data?.error || "تعذّر جلب معلومات الوسائط");
  return data;
}

export const apiConfig = { base: BASE };
