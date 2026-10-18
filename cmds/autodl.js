"use strict";
import http from "../src/utils/fetchHttp.js";
import fs from "fs-extra";
import {
  directSend, downloadToTemp, sendFile, streamAndSend, normalizeMediaUrl,
} from "../src/utils/media.js";
import { checkCooldown, setCooldown } from "../src/utils/access.js";
import { downloadWithFallback } from "../src/utils/youtube.js";

/* ============================================================
 * المنصات المدعومة (4 فقط)
 * ============================================================ */
const PLATFORM_HOSTS = {
  tiktok: [
    "tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "tiktokv.com", "m.tiktok.com",
  ],
  youtube: [
    "youtube.com", "youtu.be", "youtube-nocookie.com", "music.youtube.com", "gaming.youtube.com",
  ],
  instagram: [
    "instagram.com", "instagr.am", "ig.me",
  ],
  facebook: [
    "facebook.com", "fb.watch", "fb.com", "fb.me", "fb.gg",
  ],
};

const PLATFORM_LABELS = {
  tiktok:    "TikTok",
  youtube:   "YouTube",
  instagram: "Instagram",
  facebook:  "Facebook",
};

function hostMatchesDomain(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

function detectPlatform(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  for (const [platform, domains] of Object.entries(PLATFORM_HOSTS)) {
    if (domains.some(d => hostMatchesDomain(host, d))) return platform;
  }
  return null;
}

/* ============================================================
 * استخراج الروابط من الرسائل والمرفقات
 * ============================================================ */
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

function extractUrl(text) {
  return text?.match(URL_RE)?.[0]?.replace(/[.,)]+$/, "") || null;
}

function extractAllUrls(text) {
  return (text?.match(URL_RE) || []).map(u => u.replace(/[.,)]+$/, ""));
}

function extractUrlFromEvent(event) {
  const fromBody = extractUrl(event.body) || extractUrl(event.messageReply?.body);
  if (fromBody && detectPlatform(fromBody)) return fromBody;

  const attachments = [
    ...(event.attachments || []),
    ...(event.messageReply?.attachments || []),
  ];

  for (const att of attachments) {
    const direct = att?.url || att?.facebookUrl || att?.attachUrl || att?.source || att?.target?.url;
    if (direct && detectPlatform(direct)) return direct;

    let candidates = [];
    try { candidates = extractAllUrls(JSON.stringify(att)); } catch { /* circular */ }
    const match = candidates.find(u => detectPlatform(u));
    if (match) return match;
  }

  return fromBody || null;
}

/* ============================================================
 * 1) TikTok — cedds REST API
 * ============================================================ */
async function resolveTikTok(url) {
  const { data } = await http.get(
    "https://ceddsrestapi.vercel.app/downloader/tikdl",
    {
      params:  { url },
      timeout: 60_000,
      headers: { "User-Agent": "Mozilla/5.0" },
    }
  );

  const d = data?.answer || data?.data || data;
  if (!d?.downloadLink) {
    throw new Error("TikTok: لم يُعثر على رابط الفيديو في رد cedds");
  }

  return {
    title:     d.description || d.author || "فيديو تيك توك",
    videoUrl:  d.downloadLink,
    audioUrl:  d.mp3DownloadLink || null,
    thumbnail: d.profilePic  || null,
    author:    d.author      || null,
    platform: "tiktok",
  };
}

/* ============================================================
 * 2) Facebook — cedds REST API + fallback (aminul)
 * ============================================================ */
async function resolveMetaMedia(url) {
  const { data } = await http.get(
    "https://aminul-rest-api-three.vercel.app/downloader/alldownloader",
    { params: { url }, timeout: 30_000 }
  );
  const info = data?.data?.data || data?.data || data;
  if (!info) throw new Error("Meta: استجابة فارغة");
  const mediaUrl = info.high || info.hd || info.video || info.low || info.sd || info.url;
  return {
    title:    info.title || "Facebook Media",
    videoUrl: mediaUrl,
    images:   info.images || info.photos || null,
    platform: "facebook",
  };
}

async function resolveFacebook(url) {
  try {
    const { data } = await http.get(
      "https://ceddsrestapi.vercel.app/downloader/fbdl",
      {
        params:  { url },
        timeout: 60_000,
        headers: { "User-Agent": "Mozilla/5.0" },
      }
    );
    const d = data?.answer || data?.data || data;
    if (!d?.url) throw new Error("رد فارغ من cedds");

    return {
      title:     d.title     || "فيديو فيسبوك",
      videoUrl:  d.url,
      thumbnail: d.thumbnail || null,
      platform: "facebook",
    };
  } catch (e) {
    console.warn(`[FB] cedds فشل: ${e.message} — تجريب المزوّد الاحتياطي`);
    return resolveMetaMedia(url);
  }
}

/* ============================================================
 * 3) Instagram — smfahim.xyz API
 * ============================================================ */
async function resolveInstagram(url) {
  const API_BASE = "https://smfahim.xyz/api/v2/dl";
  let res;
  try {
    res = await fetch(`${API_BASE}?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`فشل الاتصال بـ smfahim: ${err.message}`);
  }

  if (!res.ok) throw new Error(`فشل الاتصال بـ smfahim (HTTP ${res.status})`);

  const json = await res.json();
  if (json?.status === false || json?.success === false) {
    throw new Error(json?.message || "المنشور خاص أو الرابط غير صحيح");
  }

  const extractMedia = (obj) => {
    if (obj?.links && typeof obj.links === "object") {
      const { hd, sd, url, video } = obj.links;
      return hd || sd || url || video;
    }
    const data = obj?.data ?? obj?.result ?? obj;
    const item = Array.isArray(data) ? data[0] : data;
    if (item?.links) {
      const { hd, sd, url } = item.links;
      return hd || sd || url;
    }
    return item?.url || item?.video_url || item?.videoUrl ||
           item?.download_url || item?.downloadUrl || item?.media_url ||
           item?.hd || item?.sd;
  };

  const mediaUrl = extractMedia(json);
  if (!mediaUrl) throw new Error("لم يُعثر على رابط الوسائط");

  const title = json?.title || json?.data?.title || json?.result?.title ||
                (Array.isArray(json?.data) ? json.data[0]?.title : null) ||
                "فيديو انستغرام";

  return { title, videoUrl: mediaUrl, platform: "instagram" };
}

/* ============================================================
 * 4) YouTube
 * ============================================================ */
async function resolveYouTube(url) {
  try {
    const result = await downloadWithFallback(url, true);
    return {
      title:    result.title || "YouTube Video",
      filePath: result.filePath,
      platform: "youtube",
      isFile:   true,
    };
  } catch (e) {
    throw new Error(`فشل تحميل يوتيوب: ${e.message}`);
  }
}

/* ============================================================
 * الموجّه الرئيسي
 * ============================================================ */
async function resolveMedia(url) {
  const normalizedUrl = await normalizeMediaUrl(url);
  const platform = detectPlatform(normalizedUrl);

  switch (platform) {
    case "tiktok":    return resolveTikTok(normalizedUrl);
    case "youtube":   return resolveYouTube(normalizedUrl);
    case "instagram": return resolveInstagram(normalizedUrl);
    case "facebook":  return resolveFacebook(normalizedUrl);
    default:          throw new Error("منصة غير مدعومة");
  }
}

/* ============================================================
 * تحميل الصور (للـ carousels) مع إدارة آمنة للملفات
 * ============================================================ */
async function downloadImages(urls) {
  const files = [];
  for (const imgUrl of urls) {
    try {
      const { tmpPath } = await downloadToTemp(imgUrl, "jpg");
      files.push(tmpPath);
    } catch (err) {
      console.error("[AUTODL_IMAGES] فشل تحميل صورة:", err?.message);
    }
  }
  if (files.length === 0) throw new Error("فشل تحميل جميع صور الكاروسيل");
  return files;
}

/* ============================================================
 * التنزيل + الإرسال
 * ============================================================ */
async function downloadAndSend(api, event, url) {
  const { threadID, messageID } = event;
  try {
    const media = await resolveMedia(url);
    console.log(
      `[AUTODL] resolved: "${media.title}" | src=${url} | media=${media.videoUrl || media.audioUrl || media.imageUrl || "(file)"}`
    );

    if (media.isFile) {
      return await sendFile(api, threadID, media.filePath, media.title, messageID);
    }

    if (Array.isArray(media.images) && media.images.length > 0) {
      const files = await downloadImages(media.images);
      try {
        await directSend(
          api, threadID,
          { attachment: files.map(f => fs.createReadStream(f)) },
          messageID
        );
        return true;
      } finally {
        await Promise.allSettled(files.map(f => fs.remove(f)));
      }
    }

    if (media.imageUrl && !media.videoUrl && !media.audioUrl) {
      return await streamAndSend(api, threadID, media.imageUrl, media.title, "jpg", messageID);
    }

    if (media.audioUrl && !media.videoUrl) {
      return streamAndSend(api, threadID, media.audioUrl, media.title, "mp3", messageID);
    }

    const videoUrl = media.videoUrl;
    if (!videoUrl) throw new Error("لم يُعثر على رابط تحميل");
    return streamAndSend(api, threadID, videoUrl, media.title, "mp4", messageID);
  } catch (e) {
    console.error(`[AUTODL] ${e.message?.substring(0, 120)}`);
    return false;
  }
}

/* ============================================================
 * حماية الاستخدام التلقائي (cooldown + حد للتحميلات المتزامنة)
 * ============================================================ */
const AUTO_ENABLED = !["off", "0", "false", "no"].includes(
  String(process.env.AUTODL_AUTO ?? "on").trim().toLowerCase()
);
const AUTO_MAX = 2;
const AUTO_COOLDOWN_SEC = 30;
let _autoInFlight = 0;

/* ============================================================
 * Plugin Export
 * ============================================================ */
export default {
  config: {
    name: "autodl",
    aliases: [],
    version: "2.1.0",
    role: 0,
    countDown: 6,
    category: "وسائط وتحميل",
    description:
      "تحميل فيديو/صور/صوت من 4 منصات — TikTok، Facebook، Instagram، YouTube. أرسل الرابط مباشرة للاكتشاف التلقائي.",
    usage: [
      "{pn}autodl <رابط> — تحميل يدوي",
      "أرسل الرابط مباشرة بدون أمر — اكتشاف وتحميل تلقائي",
    ],
    hidden: true,
  },

  onChat: async ({ api, event }) => {
    if (!AUTO_ENABLED) return;
    const url = extractUrlFromEvent(event);
    if (!url || !detectPlatform(url)) return;

    const uid = String(event.senderID);
    if (checkCooldown(uid, "autodl:auto") || _autoInFlight >= AUTO_MAX) return;
    setCooldown(uid, "autodl:auto", AUTO_COOLDOWN_SEC);

    _autoInFlight++;
    try { await downloadAndSend(api, event, url); }
    finally { _autoInFlight--; }
  },

  onStart: async ({ api, event, args, message }) => {
    const url = args[0];
    if (!url) {
      const platforms = Object.values(PLATFORM_LABELS).join(" · ");
      return message.reply(
        "📥 أمر التحميل التلقائي\n\n" +
        "📝 الاستخدام: autodl <رابط>\n\n" +
        "🌐 المنصات المدعومة:\n" + platforms + "\n\n" +
        "💡 أو أرسل الرابط مباشرة بدون أمر!"
      );
    }

    const platform = detectPlatform(url);
    const label = platform ? PLATFORM_LABELS[platform] || platform : "غير محدد";

    const statusMsg = await new Promise((res, rej) =>
      global.safeSend(
        api,
        `⏳ جاري التحميل من ${label}...`,
        event.threadID,
        (e, i) => (e ? rej(e) : res(i)),
        event.messageID
      )
    ).catch(() => null);

    const ok = await downloadAndSend(api, event, url);

    if (statusMsg?.messageID) {
      api.unsendMessage(statusMsg.messageID, event.threadID).catch(() => {});
    }

    if (!ok) message.reply("❌ تعذّر التحميل، تأكد من الرابط أو حاول لاحقاً.");
  },
};
