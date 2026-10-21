"use strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { tiktok } from "shadowx-tiksr";
import { downloadAndSend as ytdlpDownload } from "./autodl.js";

const HELP =
  "📺 تيك توك\n\n" +
  "fyp <كلمة بحث أو رابط>   — تحميل أول نتيجة\n" +
  "fyp fyp                  — فيديو عشوائي (FYP)\n\n" +
  "(أو تيك_توك بدل fyp)";

const RANDOM_TERMS = ["fyp", "viral", "trending", "funny", "foryou"];
const cleanTemp = (p) => p && fs.remove(p).catch(() => {});
const PAGE_URL_KEYS = ["url", "link", "webVideoUrl", "share_url", "shareUrl"];
const pageUrlOf = (v) => PAGE_URL_KEYS.map((k) => v?.[k]).find(Boolean) || null;

/* ───────────────── بحث عبر shadowx-tiksr (الطريقة الأساسية) ───────────────── */
async function searchVideo(query) {
  try {
    const results = await tiktok.search(query);
    return results?.[0] || null;
  } catch (e) {
    console.error("❌ [fyp] خطأ في البحث:", e.message);
    return null;
  }
}

async function randomVideo() {
  try {
    const term = RANDOM_TERMS[Math.floor(Math.random() * RANDOM_TERMS.length)];
    const results = await tiktok.search(term);
    if (!results?.length) return null;
    return results[Math.floor(Math.random() * results.length)];
  } catch (e) {
    console.error("❌ [fyp] خطأ في الفيديو العشوائي:", e.message);
    return null;
  }
}

/* ───────────────── تحميل مباشر لرابط CDN (play/download) ───────────────── */
async function downloadDirect(api, threadID, messageID, videoUrl) {
  const filePath = path.join(os.tmpdir(), `tiktok_${Date.now()}_${randomUUID()}.mp4`);
  try {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await Bun.write(filePath, response);
    if (!(await fs.stat(filePath)).size) throw new Error("الملف فارغ");
    await global.mediaSendFile(api, filePath, threadID, messageID);
    return true;
  } catch (e) {
    console.warn("⚠️  [fyp] فشل التحميل المباشر، التحويل إلى ytdlp API:", e.message);
    return false;
  } finally {
    await cleanTemp(filePath);
  }
}

export default {
  config: {
    name: "fyp",
    aliases: ["تيك_توك"],
    version: "2.1.0",
    role: 0,
    countDown: 5,
    category: "وسائط وتحميل",
    description: "تحميل فيديوهات تيك توك عبر shadowx-tiksr، مع التحويل تلقائياً إلى ytdlp API عند الفشل.",
    usage: [
      "{pn}fyp <كلمة بحث أو رابط> — تحميل أول نتيجة",
      "{pn}fyp fyp — فيديو عشوائي",
    ],
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;
    if (!args[0]) return message.reply(HELP);

    const raw = args.join(" ").trim();

    // رابط مباشر → ytdlp API مباشرة (نفس آلية autodl.js)، بدون المرور بالبحث
    if (/^https?:\/\//i.test(raw)) {
      const ok = await ytdlpDownload(api, event, raw, "video");
      if (!ok) await message.reply("❌ تعذّر تحميل الفيديو.");
      return;
    }

    const wantRandom = raw.toLowerCase() === "fyp";
    const video = wantRandom ? await randomVideo() : await searchVideo(raw);
    if (!video) return message.reply("❌ لا توجد نتائج.");

    const directUrl = video.play || video.download;
    let sent = directUrl ? await downloadDirect(api, threadID, messageID, directUrl) : false;

    if (!sent) {
      const pageUrl = pageUrlOf(video);
      if (pageUrl) sent = await ytdlpDownload(api, event, pageUrl, "video");
    }

    if (!sent) await message.reply("❌ تعذّر تحميل الفيديو.");
  },
};
