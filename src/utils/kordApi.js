import fs from "fs-extra";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import http from "./fetchHttp.js";

const BASE = (process.env.KORD_API_BASE_URL || "https://api.kord.live").replace(/\/+$/, "");
const KEY = process.env.KORD_API_KEY?.trim();

function headers() {
  return KEY ? { Authorization: `Bearer ${KEY}`, Accept: "application/json" } : { Accept: "application/json" };
}

function directUrl(payload) {
  return payload?.data?.url || payload?.url || payload?.result?.url || payload?.data?.downloadUrl || payload?.downloadUrl || null;
}

function titleOf(payload, fallback = "YouTube media") {
  return payload?.data?.title || payload?.title || payload?.result?.title || payload?.data?.filename || fallback;
}

async function streamToTempFile(url, title, ext) {
  const filePath = path.join(os.tmpdir(), `kord_yt_${Date.now()}_${randomUUID()}.${ext}`);
  try {
    const response = await http.get(url, {
      responseType: "stream",
      timeout: 120000,
      headers: { Accept: "video/mp4,audio/mpeg,*/*", "User-Agent": "SunkenBot/4.0" },
    });
    await pipeline(response.data, fs.createWriteStream(filePath));
    const stat = await fs.stat(filePath);
    if (!stat.size) throw new Error("Kord أعاد ملفًا فارغًا");
    return { filePath, title, duration: 0, uploader: "" };
  } catch (error) {
    await fs.remove(filePath).catch(() => {});
    throw error;
  }
}

export async function downloadFromKord(url, wantMp4 = false) {
  const endpoint = wantMp4 ? "/api/yt-savetube" : "/api/ytmp3";
  const params = wantMp4 ? { url: String(url), type: "720" } : { url: String(url) };
  const response = await http.get(`${BASE}${endpoint}`, { params, headers: headers(), timeout: 120000 });
  const payload = response.data;
  const mediaUrl = directUrl(payload);
  if (!mediaUrl) throw new Error(`Kord لم يُرجع رابط تنزيل من ${endpoint}`);
  const ext = wantMp4 ? "mp4" : "mp3";
  return streamToTempFile(mediaUrl, titleOf(payload), ext);
}

export const kordConfig = { base: BASE };
