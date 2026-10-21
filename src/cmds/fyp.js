"use strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import ShadowXTikSR from "shadowx-tiksr";
import { downloadAndSend as ytdlpDownload } from "./autodl.js";

const HELP =
  "📺 تيك توك\n\n" +
  "fyp <كلمة بحث أو رابط>   — تحميل أول نتيجة\n" +
  "fyp fyp                  — فيديو عشوائي (FYP)\n\n" +
  "(أو تيك_توك بدل fyp)";

// shadowx-tiksr: module.exports = class ShadowXTikSR { ... }، مع module.exports.default = new ShadowXTikSR()
const tiktokClient = ShadowXTikSR?.default ?? new ShadowXTikSR();

const RANDOM_TERMS = ["fyp", "viral", "trending", "funny", "foryou"];
const cleanTemp = (p) => p && fs.remove(p).catch(() => {});

/* ───────────────── بحث عبر shadowx-tiksr (يرجع نتيجة واحدة) ───────────────── */
async function searchVideo(query) {
  try {
    return await tiktokClient.search(query);
  } catch (e) {
    console.error("❌ [fyp] خطأ في البحث:", e.message);
    return null;
  }
}

async function randomVideo() {
  const term = RANDOM_TERMS[Math.floor(Math.random() * RANDOM_TERMS.length)];
  return searchVideo(term);
}

const videoUrlOf = (v) => v?.downloads?.video || v?.video?.play_url || null;

/* ───────────────── تحميل مباشر، مع تحويل لـ ytdlp API عند الفشل ───────────────── */
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
    version: "3.0.0",
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

    // رابط مباشر → ytdlp API مباشرة (نفس آلية autodl.js)
    if (/^https?:\/\//i.test(raw)) {
      const ok = await ytdlpDownload(api, event, raw, "video");
      if (!ok) await message.reply("❌ تعذّر تحميل الفيديو.");
      return;
    }

    const wantRandom = raw.toLowerCase() === "fyp";
    const video = wantRandom ? await randomVideo() : await searchVideo(raw);
    if (!video) return message.reply("❌ لا توجد نتائج.");

    const url = videoUrlOf(video);
    if (!url) return message.reply("❌ لا يوجد رابط فيديو صالح.");

    let sent = await downloadDirect(api, threadID, messageID, url);
    if (!sent) sent = await ytdlpDownload(api, event, url, "video");
    if (!sent) await message.reply("❌ تعذّر تحميل الفيديو.");
  },
};
