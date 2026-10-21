"use strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import axios from "axios";

const SEARCH_API = "https://mahi-apis.onrender.com/api/tiktok";
const HELP =
  "📺 تيك توك\n\n" +
  "fyp <كلمة بحث>   — تحميل أول نتيجة\n" +
  "fyp fyp          — فيديو عشوائي (FYP)\n\n" +
  "(أو تيك_توك بدل fyp)";

const cleanTemp = (p) => p && fs.remove(p).catch(() => {});

/* ───────────────── تحميل مكتبة السكرابر (الطريقة الأساسية) ───────────────── */
let _scraper = null;
async function loadScraper() {
  if (_scraper !== null) return _scraper;
  try {
    _scraper = await import("@bochilteam/scraper");
  } catch (e) {
    console.warn("⚠️  [fyp] @bochilteam/scraper غير متاحة، الانتقال إلى API:", e.message);
    _scraper = false;
  }
  return _scraper;
}

/* ───────────────── احتياطي: API خارجي عبر axios ───────────────── */
async function searchViaApi(query) {
  try {
    const { data } = await axios.get(SEARCH_API, { params: { search: query }, timeout: 15000 });
    return data?.data || [];
  } catch (e) {
    console.error("❌ [fyp] خطأ API:", e.message);
    return [];
  }
}

/* ───────────────── فيديو عشوائي: مكتبة أولاً ثم API احتياطياً ───────────────── */
async function getRandomVideo() {
  const scraper = await loadScraper();
  if (scraper?.tiktokfyp) {
    try {
      const list = Object.values((await scraper.tiktokfyp()) || {});
      if (list.length) return list[Math.floor(Math.random() * list.length)];
    } catch (e) {
      console.warn("⚠️  [fyp] فشلت المكتبة في جلب FYP، الانتقال إلى API:", e.message);
    }
  }
  const results = await searchViaApi("fyp");
  return results[Math.floor(Math.random() * results.length)] || null;
}

/* ───────────────── بحث بكلمة: مكتبة أولاً (إن توفّر دعم البحث) ثم API احتياطياً ───────────────── */
async function searchVideo(query) {
  const scraper = await loadScraper();
  const libSearch = scraper?.tiktoksearch || scraper?.ttsearch || scraper?.tiktokSearch;
  if (libSearch) {
    try {
      const res = await libSearch(query);
      const list = Array.isArray(res) ? res : Object.values(res?.data || res || {});
      if (list.length) return list[0];
    } catch (e) {
      console.warn("⚠️  [fyp] فشل بحث المكتبة، الانتقال إلى API:", e.message);
    }
  }
  const results = await searchViaApi(query);
  return results[0] || null;
}

const videoUrlOf = (v) => v?.video?.downloadAddr || v?.video?.playAddr || v?.video || v?.downloadAddr || null;

/* ───────────────── تحميل الفيديو وإرساله ───────────────── */
async function downloadAndSend(api, threadID, messageID, videoUrl) {
  const filePath = path.join(os.tmpdir(), `tiktok_${Date.now()}_${randomUUID()}.mp4`);
  try {
    const res = await axios.get(videoUrl, { responseType: "stream", timeout: 60000 });
    await pipeline(res.data, fs.createWriteStream(filePath));
    if (!(await fs.stat(filePath)).size) throw new Error("الملف فارغ");
    await global.mediaSendFile(api, filePath, threadID, messageID);
  } catch (e) {
    console.error("❌ [fyp] خطأ في التحميل:", e.message);
    global.safeSend(api, "❌ تعذّر تحميل الفيديو.", threadID, null, messageID);
  } finally {
    await cleanTemp(filePath);
  }
}

export default {
  config: {
    name: "fyp",
    aliases: ["تيك_توك"],
    version: "1.0.0",
    role: 0,
    countDown: 5,
    category: "وسائط وتحميل",
    description: "تحميل فيديوهات تيك توك: مكتبة @bochilteam/scraper أولاً، وAPI خارجي عبر axios كاحتياط.",
    usage: [
      "{pn}fyp <كلمة بحث> — تحميل أول نتيجة بحث",
      "{pn}fyp fyp — فيديو عشوائي من FYP",
    ],
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;
    if (!args[0]) return message.reply(HELP);

    const wantRandom = args[0].toLowerCase() === "fyp";
    const query = args.join(" ").trim();

    const video = wantRandom ? await getRandomVideo() : await searchVideo(query);
    if (!video) return message.reply(wantRandom ? "❌ تعذّر جلب فيديو عشوائي حالياً." : `⚠️  لا توجد نتائج لـ: "${query}".`);

    const url = videoUrlOf(video);
    if (!url) return message.reply("❌ لا يوجد رابط فيديو صالح.");
    await downloadAndSend(api, threadID, messageID, url);
  },
};
