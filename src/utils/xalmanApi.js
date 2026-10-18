import fs from "fs-extra";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import http from "./fetchHttp.js";

const BASE = (process.env.XALMAN_API_BASE_URL || "https://xalman-apis.vercel.app").replace(/\/+$/, "");

function directUrl(payload) {
  return payload?.url || payload?.data?.url || payload?.result?.url || payload?.download?.url || null;
}

function titleOf(payload, fallback = "YouTube media") {
  return payload?.title || payload?.data?.title || payload?.result?.title || payload?.filename || fallback;
}

async function streamToTempFile(url, title, ext) {
  const filePath = path.join(os.tmpdir(), `xalman_yt_${Date.now()}_${randomUUID()}.${ext}`);
  try {
    const response = await http.get(url, {
      responseType: "stream",
      timeout: 120000,
      headers: { Accept: "video/mp4,audio/mpeg,*/*", "User-Agent": "SunkenBot/4.0" },
    });
    await pipeline(response.data, fs.createWriteStream(filePath));
    const stat = await fs.stat(filePath);
    if (!stat.size) throw new Error("Xalman أعاد ملفًا فارغًا");
    return { filePath, title, duration: 0, uploader: "" };
  } catch (error) {
    await fs.remove(filePath).catch(() => {});
    throw error;
  }
}

export async function downloadFromXalman(url, wantMp4 = false) {
  const endpoint = wantMp4 ? "/api/ytdl" : "/api/ytmp3";
  const response = await http.get(`${BASE}${endpoint}`, {
    params: { url: String(url) },
    timeout: 120000,
  });
  const payload = response.data;
  const mediaUrl = directUrl(payload);
  if (!mediaUrl) throw new Error(`Xalman لم يُرجع رابط تنزيل من ${endpoint}`);
  return streamToTempFile(mediaUrl, titleOf(payload), wantMp4 ? "mp4" : "mp3");
}

export const xalmanConfig = { base: BASE };
