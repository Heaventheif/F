"use strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// ─── الإعدادات من متغيرات البيئة ─────────────────────────────────
// API_URL    : خدمة التنزيل      مثال: https://my-api.vercel.app
// TIKTOK_API : خدمة بحث تيك توك   مثال: https://my-tiktok.vercel.app
// (بدون / في النهاية)
function envUrl(name) {
  const url = (process.env[name] || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url))
    throw new Error(`متغير البيئة ${name} غير مضبوط أو غير صالح`);
  return url;
}
const getApiUrl = () => envUrl("API_URL");
const getTiktokApi = () => envUrl("TIKTOK_API");

const HELP =
  "📺 تيك توك\n\n" +
  "fyp <كلمة بحث أو رابط>   — تحميل أول نتيجة\n" +
  "fyp fyp                  — فيديو عشوائي (FYP)\n\n" +
  "(أو تيك_توك بدل fyp)";

const RANDOM_TERMS = ["fyp", "viral", "trending", "funny", "foryou"];
const cleanTemp = (p) => p && fs.remove(p).catch(() => {});

/* ───────────────── بحث عبر TikTok Search API ───────────────── */
async function searchVideo(query) {
  try {
    const res = await fetch(
      `${getTiktokApi()}/api/search?q=${encodeURIComponent(query)}&limit=1`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const first = data.videos?.[0];
    if (!first) return null;
    return { url: first.url, id: first.id, description: first.description, author: first.author };
  } catch (e) {
    console.error("❌ [fyp] خطأ في البحث:", e.message);
    return null;
  }
}

async function randomVideo() {
  const term = RANDOM_TERMS[Math.floor(Math.random() * RANDOM_TERMS.length)];
  return searchVideo(term);
}

/* ───────────────── تنزيل عبر API_URL ───────────────── */
async function downloadAndSend(api, threadID, messageID, url) {
  const filePath = path.join(os.tmpdir(), `tiktok_${Date.now()}_${randomUUID()}.mp4`);
  try {
    const res = await fetch(`${getApiUrl()}/api/v1/download?url=${encodeURIComponent(url)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`فشل التنزيل (HTTP ${res.status}): ${body.substring(0, 200)}`);
    }

    if (!res.body) throw new Error("استجابة بدون محتوى");
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(filePath));

    if (!(await fs.stat(filePath)).size) throw new Error("الملف فارغ");

    await global.mediaSendFile(api, filePath, threadID, messageID);
    return true;
  } catch (e) {
    console.error("❌ [fyp] خطأ في التنزيل:", e.message);
    return false;
  } finally {
    await cleanTemp(filePath);
  }
}

export default {
  config: {
    name: "fyp",
    aliases: ["تيك_توك"],
    version: "6.0.0",
    role: 0,
    countDown: 5,
    category: "وسائط وتحميل",
    description: "تحميل فيديوهات تيك توك — بحث + تنزيل عبر API.",
    usage: [
      "{pn}fyp <كلمة بحث أو رابط> — تحميل أول نتيجة",
      "{pn}fyp fyp — فيديو عشوائي",
    ],
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;
    if (!args[0]) return message.reply(HELP);

    const raw = args.join(" ").trim();

    // تحقّق من الإعدادات قبل أي عمل
    try {
      getApiUrl();
      if (!/^https?:\/\//i.test(raw)) getTiktokApi();
    } catch (e) {
      console.error("❌ [fyp]", e.message);
      return message.reply(`⚠️ ${e.message}`);
    }

    // رابط مباشر → تنزيل مباشر عبر API
    if (/^https?:\/\//i.test(raw)) {
      const ok = await downloadAndSend(api, threadID, messageID, raw);
      if (!ok) await message.reply("❌ تعذّر تحميل الفيديو.");
      return;
    }

    // بحث
    const wantRandom = raw.toLowerCase() === "fyp";
    const video = wantRandom ? await randomVideo() : await searchVideo(raw);
    if (!video) return message.reply("❌ لا توجد نتائج.");

    const ok = await downloadAndSend(api, threadID, messageID, video.url);
    if (!ok) await message.reply("❌ تعذّر تحميل الفيديو.");
  },
};
