import fs from "fs-extra";
import os from "os";
import path from "path";
import https from "https";
import http from "http";
import { execFile } from "child_process";
import { randomUUID } from "node:crypto";
import { assertSafeUrl } from "./fetchHttp.js";
const MAX_PART_BYTES = 24 * 1024 * 1024;
const TARGET_PART_BYTES = Math.floor(MAX_PART_BYTES * 0.9);
const MAX_SPLIT_ATTEMPTS = 3;
const CHILD_ENV = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR };
function NEEDS_SPLIT(sizeBytes) {
  return sizeBytes > MAX_PART_BYTES;
}
function runFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 30000, env: CHILD_ENV },
      (err, stdout) => {
        if (err) return reject(err);
        const duration = parseFloat(String(stdout).trim());
        if (!duration || !isFinite(duration) || duration <= 0) {
          return reject(new Error("تعذّر قراءة مدة الملف عبر ffprobe"));
        }
        resolve(duration);
      }
    );
  });
}
function runFfmpegSegment(filePath, ext, segmentSeconds, outDir) {
  const pattern = path.join(outDir, `part_%03d.${ext}`);
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y", "-i", filePath,
        "-c", "copy",
        "-map", "0",
        "-f", "segment",
        "-segment_time", String(Math.max(1, Math.floor(segmentSeconds))),
        "-reset_timestamps", "1",
        pattern,
      ],
      { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 10, env: CHILD_ENV },
      (err, _stdout, stderr) => {
        if (err) return reject(new Error(`ffmpeg فشل: ${stderr?.toString().slice(-300) || err.message}`));
        resolve();
      }
    );
  });
}
async function segmentOnce(filePath, ext, size, workDir) {
  const duration = await runFfprobe(filePath);
  const bytesPerSecond = size / duration;
  const segmentSeconds = Math.max(1, TARGET_PART_BYTES / bytesPerSecond);
  await runFfmpegSegment(filePath, ext, segmentSeconds, workDir);
  const files = (await fs.readdir(workDir))
    .filter(f => f.startsWith("part_"))
    .sort()
    .map(f => path.join(workDir, f));
  if (files.length === 0) throw new Error("ffmpeg لم ينتج أي أجزاء");
  return files;
}
async function splitFile(filePath, ext = "mp4") {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "split_"));
  let parts = [];
  try {
    parts = await segmentOnce(filePath, ext, (await fs.stat(filePath)).size, workDir);
    for (let attempt = 0; attempt < MAX_SPLIT_ATTEMPTS; attempt++) {
      const oversized = [];
      for (const p of parts) {
        const st = await fs.stat(p);
        if (st.size > MAX_PART_BYTES) oversized.push(p);
      }
      if (oversized.length === 0) break;
      for (const p of oversized) {
        const subDir = await fs.mkdtemp(path.join(os.tmpdir(), "resplit_"));
        try {
          const st = await fs.stat(p);
          const subParts = await segmentOnce(p, ext, st.size, subDir);
          const finalSubParts = [];
          for (const sp of subParts) {
            const dest = path.join(workDir, `${path.basename(p, path.extname(p))}_${path.basename(sp)}`);
            await fs.move(sp, dest, { overwrite: true });
            finalSubParts.push(dest);
          }
          const idx = parts.indexOf(p);
          parts.splice(idx, 1, ...finalSubParts);
          await fs.remove(p).catch(() => {});
        } finally {
          await fs.remove(subDir).catch(() => {});
        }
      }
    }
    if (parts.length === 0) {
      const err = new Error("تعذّر تقسيم الملف إلى أجزاء صالحة.");
      err.code = "FILE_TOO_LARGE";
      throw err;
    }
    return parts;
  } catch (e) {
    await fs.remove(workDir).catch(() => {});
    if (e.code === "FILE_TOO_LARGE") throw e;
    const err = new Error(`تعذّر تقسيم الملف: ${e.message}`);
    err.code = "FILE_TOO_LARGE";
    throw err;
  }
}
async function cleanupParts(partPaths) {
  await Promise.allSettled((partPaths || []).map(p => fs.remove(p)));
  const dirs = new Set((partPaths || []).map(p => path.dirname(p)));
  await Promise.allSettled([...dirs].map(d => fs.remove(d)));
}
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
async function fetchStream(url, redirectCount = 0) {
  await assertSafeUrl(url);
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("تجاوز الحد الأقصى لإعادة التوجيه"));
    const isHttps = url.startsWith("https");
    const lib = isHttps ? https : http;
    lib.get(url, { timeout: 120000 }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) {
        res.resume();
        const location = headers.location;
        if (!location) return reject(new Error("إعادة توجيه بدون Location header"));
        let next;
        try { next = new URL(location, url).href; }
        catch { return reject(new Error("Location غير صالح في إعادة التوجيه")); }
        return fetchStream(next, redirectCount + 1).then(resolve).catch(reject);
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} من الخادم`));
      }
      resolve({ stream: res, contentLength: parseInt(headers["content-length"] || "0", 10) });
    }).on("error", reject)
      .on("timeout", function() { this.destroy(new Error("انتهت مهلة الاتصال")); });
  });
}
async function downloadToTemp(url, ext = "mp4") {
  const { stream, contentLength } = await fetchStream(url);
  if (contentLength > 0 && contentLength > MAX_DOWNLOAD_BYTES) {
    stream.resume();
    throw Object.assign(new Error(`حجم الملف (${Math.round(contentLength / 1024 / 1024)}MB) يتجاوز الحد المسموح (${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)}MB)`), { code: "FILE_TOO_LARGE" });
  }
  const tmpPath = path.join(os.tmpdir(), `media_${randomUUID()}.${ext}`);
  const writer = fs.createWriteStream(tmpPath);
  let bytesReceived = 0;
  await new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_DOWNLOAD_BYTES) {
        stream.destroy();
        writer.destroy();
        fs.remove(tmpPath).catch(() => {});
        reject(Object.assign(new Error(`الملف تجاوز الحد الأقصى (${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)}MB) أثناء التحميل`), { code: "FILE_TOO_LARGE" }));
      }
    });
    stream.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
    stream.on("error", reject);
  });
  const stat = await fs.stat(tmpPath);
  return { tmpPath, size: stat.size, contentLength };
}
async function directSend(api, threadID, messageBody, replyToID = undefined) {
  try {
    await global.safeSend(api, messageBody, threadID, undefined, replyToID);
    return true;
  } catch (e) {
    console.error("[DIRECT_SEND] خطأ:", e?.message?.substring(0, 120));
    return false;
  }
}
const PART_RETRY_ATTEMPTS = 3;
const PART_RETRY_DELAY_MS = 1500;
async function directSendParts(api, threadID, title, streams, replyToID = undefined) {
  const total = streams.length;
  let sent = 0;
  const failedParts = [];
  for (let i = 0; i < total; i++) {
    const stream = streams[i]?.stream ?? streams[i];
    let ok = false;
    for (let attempt = 1; attempt <= PART_RETRY_ATTEMPTS && !ok; attempt++) {
      const attemptStream = (attempt > 1 && typeof streams[i]?.reopen === "function")
        ? streams[i].reopen()
        : stream;
      ok = await directSend(api, threadID, { attachment: attemptStream }, replyToID);
      if (!ok && attempt < PART_RETRY_ATTEMPTS) {
        console.warn(`[DIRECT_SEND] إعادة محاولة الجزء ${i + 1}/${total} (محاولة ${attempt + 1}/${PART_RETRY_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, PART_RETRY_DELAY_MS * attempt));
      }
    }
    if (ok) {
      sent++;
    } else {
      failedParts.push(i + 1);
      console.warn(`[DIRECT_SEND] فشل إرسال الجزء ${i + 1}/${total} نهائياً بعد ${PART_RETRY_ATTEMPTS} محاولات`);
    }
  }
  if (failedParts.length > 0) {
    const note = `⚠️ فشل إرسال ${failedParts.length} من ${total} جزء (الأجزاء: ${failedParts.join(", ")}) — ${title || ""}`.trim();
    await directSend(api, threadID, note, replyToID).catch(() => {});
  }
  return { sent, failedParts, total };
}
async function downloadWithLimit(items, fetchFn, limit = 6) {
  const results = new Array(items.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fetchFn(items[i], i); }
      catch { results[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
/* ───────── إرسال ملف محلي (تقسيم تلقائي + حذف الملف دائماً) ───────── */
async function sendFile(api, threadID, filePath, title, replyToID) {
  let parts = [];
  try {
    const { size } = await fs.stat(filePath);
    if (NEEDS_SPLIT(size)) {
      const ext = path.extname(filePath).slice(1) || "mp4";
      parts = await splitFile(filePath, ext);
      const streams = parts.map(p => ({
        stream: fs.createReadStream(p),
        reopen: () => fs.createReadStream(p),
      }));
      const { sent } = await directSendParts(api, threadID, title, streams, replyToID);
      return sent > 0;
    }
    return await directSend(api, threadID, { attachment: fs.createReadStream(filePath) }, replyToID);
  } catch (e) {
    console.error("[SEND_FILE]", e?.message || e);
    return false;
  } finally {
    if (parts.length) await cleanupParts(parts).catch(() => {});
    await fs.remove(filePath).catch(() => {});
  }
}
/* ───────── تحميل رابط مباشر ثم إرساله ───────── */
async function streamAndSend(api, threadID, mediaUrl, title, ext = "mp4", replyToID = undefined) {
  let tmpPath;
  try {
    ({ tmpPath } = await downloadToTemp(mediaUrl, ext));
  } catch (e) {
    console.error("[STREAM_SEND]", e?.message?.substring(0, 200));
    if (e.code === "FILE_TOO_LARGE") {
      await global.safeSend(api, `⚠️ ${e.message}`, threadID, undefined, replyToID).catch(() => {});
      return true;
    }
    return false;
  }
  return sendFile(api, threadID, tmpPath, title, replyToID);
}
/* ───────── تطبيع روابط المنصات قبل إرسالها للمزوّدين ───────── */
const SHORTLINK_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com", "fb.watch", "fb.me", "instagr.am", "ig.me"]);
const HOST_REWRITES = [
  { test: /^(m|mobile|touch|web)\.facebook\.com$/i, to: "www.facebook.com" },
  { test: /^facebook\.com$/i,                       to: "www.facebook.com" },
  { test: /^m\.instagram\.com$/i,                   to: "www.instagram.com" },
  { test: /^instagram\.com$/i,                      to: "www.instagram.com" },
  { test: /^m\.tiktok\.com$/i,                      to: "www.tiktok.com" },
  { test: /^tiktok\.com$/i,                         to: "www.tiktok.com" },
];
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "igshid", "igsh", "si", "ref", "ref_src", "feature", "is_from_webapp", "sender_device", "_r", "_t", "mibextid"]);
async function resolveShortlink(rawUrl) {
  try {
    const res = await fetch(rawUrl, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(6000) });
    res.body?.cancel?.().catch(() => {});
    return res.url || rawUrl;
  } catch { return rawUrl; }
}
async function normalizeMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  const current = rawUrl.trim();
  let u;
  try { u = new URL(current); } catch { return current; }
  if (SHORTLINK_HOSTS.has(u.hostname.toLowerCase())) {
    try { u = new URL(await resolveShortlink(current)); } catch {}
  }
  const rule = HOST_REWRITES.find(r => r.test.test(u.hostname));
  if (rule) u.hostname = rule.to;
  for (const key of [...u.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || k.startsWith("utm_")) u.searchParams.delete(key);
  }
  u.hash = "";
  return u.toString();
}
export { splitFile, cleanupParts, NEEDS_SPLIT, fetchStream, downloadToTemp, directSend, directSendParts, downloadWithLimit, sendFile, streamAndSend, normalizeMediaUrl };
