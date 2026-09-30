import { downloadMedia } from "../utils/mediaApi.js";
"use strict";
import http from "../utils/fetchHttp.js";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { streamAndSend } from "../utils/mediaStream.js";
import { directSend, directSendParts } from "../utils/directSend.js";
import { cleanTemp } from "../utils/ytProviders.js";
import { normalizeMediaUrl } from "../utils/urlNormalizer.js";
import { getYozoraInfo, getYozoraTitle, buildYozoraDownloadUrl } from "../utils/yozora.js";
import { splitFile, cleanupParts, NEEDS_SPLIT } from "../utils/mediaSplitter.js";
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
  twitter: [
    "twitter.com", "x.com", "t.co", "twimg.com",
  ],
  reddit: [
    "reddit.com", "redd.it",
  ],
  pinterest: [
    "pinterest.com", "pin.it",
  ],
  threads: [
    "threads.net", "threads.com",
  ],
  soundcloud: [
    "soundcloud.com", "snd.sc",
  ],
  spotify: [
    "spotify.com", "spoti.fi",
  ],
  snapchat: [
    "snapchat.com",
  ],
  capcut: [
    "capcut.com",
  ],
  dailymotion: [
    "dailymotion.com", "dai.ly",
  ],
  bluesky: [
    "bsky.app", "bsky.social",
  ],
  linkedin: [
    "linkedin.com", "lnkd.in",
  ],
  tumblr: [
    "tumblr.com", "tmblr.co",
  ],
  douyin: [
    "douyin.com", "iesdouyin.com",
  ],
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
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
function extractUrl(text) {
  return text?.match(URL_RE)?.[0]?.replace(/[.,)]+$/, "") || null;
}
// Pull every candidate URL out of a piece of text (used for scanning
// stringified attachment objects, which may contain several URLs — CDN
// thumbnails, tracking pixels, and the one we actually want).
function extractAllUrls(text) {
  return (text?.match(URL_RE) || []).map(u => u.replace(/[.,)]+$/, ""));
}
// When a Reel/post/video is sent via Messenger's native "Share" button
// (rather than pasted as text), the link does NOT appear in event.body —
// it only exists inside event.attachments as a "share" attachment (fields
// vary by fca fork: url / facebookUrl / attachUrl / source / target, etc).
// Body-only extraction silently misses these, which is why shared reels/
// posts weren't triggering auto-download. Scan the attachment payloads too,
// preferring any URL whose host we actually recognize as a supported
// platform over generic CDN/tracking links that may also be present.
function extractUrlFromEvent(event) {
  const fromBody = extractUrl(event.body) || extractUrl(event.messageReply?.body);
  if (fromBody && detectPlatform(fromBody)) return fromBody;
  const attachments = [
    ...(event.attachments || []),
    ...(event.messageReply?.attachments || []),
  ];
  for (const att of attachments) {
    // Prefer explicit known fields before falling back to a full scan.
    const direct = att?.url || att?.facebookUrl || att?.attachUrl || att?.source || att?.target?.url;
    if (direct && detectPlatform(direct)) return direct;
    let candidates = [];
    try { candidates = extractAllUrls(JSON.stringify(att)); } catch { /* circular/non-serializable, skip */ }
    const match = candidates.find(u => detectPlatform(u));
    if (match) return match;
  }
  // Nothing platform-recognizable found in attachments either — fall back
  // to whatever plain-text URL exists (even if unrecognized), so callers
  // can still short-circuit cleanly.
  return fromBody || null;
}
async function sendLocalFile(api, threadID, filePath, title, replyToID) {
  try {
    const stat = await fs.stat(filePath);
    const size = stat.size;
    const ext = path.extname(filePath).slice(1) || "mp4";
    if (NEEDS_SPLIT(size)) {
      const parts = await splitFile(filePath, ext);
      const streams = parts.map(p => ({
        stream: fs.createReadStream(p),
        reopen: () => fs.createReadStream(p),
      }));
      const { sent } = await directSendParts(api, threadID, title, streams, replyToID);
      await cleanupParts(parts);
      return sent > 0;
    } else {
      const ok = await directSend(
        api,
        threadID,
        { attachment: fs.createReadStream(filePath) },
        replyToID
      );
      await fs.remove(filePath).catch(() => {});
      return ok;
    }
  } catch (e) {
    console.error("[SEND_LOCAL] خطأ:", e.message);
    return false;
  }
}
// All Site Download — fallback عام، لأن الإصدارات v1-v18 ليست متطابقة.
const ALL_SITE_API = "https://smfahim.xyz/download/all";
function parseAllSiteResponse(payload, platform = "generic") {
  const root = payload?.data?.data || payload?.data || payload || {};
  if (root.status === false || payload?.status === false) {
    throw new Error(root.message || payload?.message || "الرابط غير مدعوم أو خاص");
  }
  const result = root.result || payload?.result || {};
  const links = root.links || result.links || {};
  const firstUrl = values => values.flat(Infinity).find(value =>
    typeof value === "string" && /^https?:\/\//i.test(value)
  ) || null;
  const videoItems = [result.video, result.media, root.video, root.media].filter(Boolean);
  const imageItems = [result.image, result.images, root.image, root.images].filter(Boolean);
  const videoUrl = root.hd || root.high || links.hd || root.video_url ||
    links.video || root.video || links.sd || root.sd || root.url ||
    firstUrl(videoItems.map(item => Array.isArray(item) ? item.map(x => x?.video || x?.url || x?.link || x) : item));
  const audioUrl = root.audio || root.mp3 || links.audio || links.mp3 ||
    firstUrl([result.audio, result.audio_url]);
  const images = imageItems.flat(Infinity).map(item =>
    typeof item === "string" ? item : item?.image || item?.url || item?.link
  ).filter(value => /^https?:\/\//i.test(value || ""));
  if (!videoUrl && !audioUrl && !images.length) {
    throw new Error("All Site: لم يُرجع رابط وسائط");
  }
  return {
    title: root.title || result.title || root.name || "وسائط",
    videoUrl: typeof videoUrl === "string" ? videoUrl : null,
    audioUrl: typeof audioUrl === "string" ? audioUrl : null,
    images: images.length ? images : null,
    thumbnail: root.thumbnail || root.thumb || null,
    platform,
  };
}
async function resolveAllSite(url, platform = "generic") {
  const versions = platform === "pinterest" ? [18, 1] : [1, 18];
  const errors = [];
  for (const version of versions) {
    try {
      const { data } = await http.get(`${ALL_SITE_API}/v${version}`, {
        params: { url },
        timeout: 45000,
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      });
      return parseAllSiteResponse(data, platform);
    } catch (error) {
      errors.push(`v${version}: ${error.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}
// TikTok — عبر Yozora/yt-dlp؛ YouTube يمر عبر Vreden داخل ytProviders.
async function resolveTikTok(url) {
  try {
    const info = await getYozoraInfo(url);
    return {
      title: getYozoraTitle(info, "فيديو تيك توك"),
      videoUrl: buildYozoraDownloadUrl(url),
      platform: "tiktok",
    };
  } catch (error) {
    throw new Error(`فشل تنزيل TikTok عبر Yozora: ${error.message}`);
  }
}
// Instagram Reels — استخراج مباشر من الصفحة العامة مع API احتياطي.
function decodeInstagramValue(value) {
  return String(value || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/\\u003D/gi, "=")
    .trim();
}
function readInstagramMeta(html, keys) {
  const wanted = new Set(keys.map(key => key.toLowerCase()));
  for (const match of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const attrs = {};
    for (const attr of tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/gi)) {
      attrs[attr[1].toLowerCase()] = attr[2];
    }
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (wanted.has(key) && attrs.content) return decodeInstagramValue(attrs.content);
  }
  return null;
}
function extractInstagramMedia(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload || {});
  const htmlVideo = readInstagramMeta(text, ["og:video:secure_url", "og:video", "og:video:url"]);
  const candidates = [
    htmlVideo,
    ...[...text.matchAll(/"(?:video_url|playback_url)"\s*:\s*"([^"\\]+(?:\\.[^"\\]*)?)"/gi)].map(m => m[1]),
    ...[...text.matchAll(/"video_versions"\s*:\s*\[[\s\S]*?"url"\s*:\s*"([^"\\]+)"/gi)].map(m => m[1]),
  ].map(decodeInstagramValue).filter(value => /^https?:\/\//i.test(value));
  const mediaUrl = candidates.find(value => /\.(?:mp4)(?:[?#]|$)/i.test(value)) || candidates[0] || null;
  const title = readInstagramMeta(text, ["og:title", "twitter:title"])
    || text.match(/"(?:title|caption)"\s*:\s*"([^"\\]*)"/i)?.[1]
    || "Instagram Reel";
  return mediaUrl ? { mediaUrl, title: decodeInstagramValue(title) } : null;
}
async function resolveInstagram(url) {
  const errors = [];
  const pageUrls = [url];
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("__a", "1");
    parsed.searchParams.set("__d", "dis");
    pageUrls.push(parsed.toString());
  } catch (_) {}
  for (const pageUrl of pageUrls) {
    try {
      const { data } = await http.get(pageUrl, {
        responseType: "text",
        timeout: 25000,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          Referer: "https://www.instagram.com/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
        },
      });
      const media = extractInstagramMedia(data);
      if (media?.mediaUrl) {
        return { title: media.title, videoUrl: media.mediaUrl, platform: "instagram" };
      }
      errors.push("Instagram: لم يوجد رابط فيديو عام في الصفحة");
    } catch (error) {
      errors.push(`Instagram page: ${error.message}`);
    }
  }
  // Legacy public API fallback; it may be unavailable, so never use it as the only route.
  try {
    const API_BASE = "https://smfahim.xyz/api/v2/dl";
    const res = await fetch(`${API_BASE}?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const media = extractInstagramMedia(json);
    if (media?.mediaUrl) {
      return { title: media.title, videoUrl: media.mediaUrl, platform: "instagram" };
    }
    errors.push("Instagram API: لم يُرجع رابط فيديو");
  } catch (error) {
    errors.push(`Instagram API: ${error.message}`);
  }
  throw new Error(errors.join(" | ") || "تعذّر تنزيل Instagram Reel");
}
async function resolveYouTube(url) {
  try {
    const result = await downloadMedia(url, { type: "video", q: 720 });
    return {
      title: result.title || "YouTube Video",
      filePath: result.filePath,
      platform: "youtube",
      isFile: true,
    };
  } catch (e) {
    throw new Error(`فشل تحميل يوتيوب عبر YTDLP API: ${e.message}`);
  }
}
async function resolveMetaMedia(url) {
  const { data } = await http.get("https://aminul-rest-api-three.vercel.app/downloader/alldownloader", {
    params: { url }, timeout: 30000,
  });
  const info = data?.data?.data || data?.data || data;
  if (!info) throw new Error("Meta: استجابة فارغة");
  const mediaUrl = info.high || info.hd || info.video || info.low || info.sd || info.url;
  return {
    title: info.title || "Meta Media",
    videoUrl: mediaUrl,
    images: info.images || info.photos || null,
    platform: "meta",
  };
}
async function resolveTwitter(url) {
  const { data } = await http.post(
    "https://twmate.com/",
    `page=${encodeURIComponent(url)}&ftype=all&ajax=1`,
    {
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        referer: "https://twmate.com/",
        "user-agent": "Mozilla/5.0",
      },
      timeout: 30000,
    }
  );
  const rows = [...(data || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const results = rows.map(r => {
    const q = r[1].match(/<td[^>]*>(.*?)<\/td>/i)?.[1]?.trim() || "";
    const link = r[1].match(/href="(https?:\/\/[^"]+)"/i)?.[1] || "";
    return link ? { quality: q, url: link } : null;
  }).filter(Boolean);
  const best = results.find(r => /720|1080|mp4/i.test(r.quality)) || results[0];
  return { title: "Twitter Video", videoUrl: best?.url, platform: "twitter" };
}
// Reddit — submagic API
async function resolveReddit(url) {
  const { data } = await http.post(
    "https://submagic-free-tools.fly.dev/api/download",
    { url },
    {
      headers: { accept: "*/*", "content-type": "application/json",
        referer: "https://submagic-free-tools.fly.dev/reddit-downloader" },
      timeout: 30000,
    }
  );
  const videoUrl = data?.url || data?.video || data?.high_quality || data?.standard_quality;
  return { title: data?.title || "Reddit Post", videoUrl, platform: "reddit" };
}
async function resolvePinterest(url) {
  const { data } = await http.get(
    `https://www.savepin.app/download.php?url=${encodeURIComponent(url)}&lang=en&type=redirect`,
    {
      headers: {
        accept: "text/html,application/xhtml+xml,*/*",
        Referer: "https://www.savepin.app/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0 Safari/537.36",
      },
      timeout: 30000,
    }
  );
  const linkMatch = (data || "").match(/href="(https:\/\/(?:v\.pinimg\.com|i\.pinimg\.com)[^"]+)"/i);
  const imgMatch  = (data || "").match(/<img[^>]+src="(https:\/\/i\.pinimg\.com\/[^"]+)"/i);
  return {
    title: "Pinterest Media",
    videoUrl: linkMatch?.[1] || null,
    imageUrl: imgMatch?.[1] || null,
    platform: "pinterest",
  };
}
async function resolveThreads(url) {
  const { data } = await http.post(
    "https://threadsv.com/get-thr",
    { token: "29ae809a4f98ebee39d8d683f851fc86", url, lang: "en" },
    {
      headers: {
        "content-type": "application/json",
        referer: "https://threadsv.com/",
        "user-agent": "Mozilla/5.0",
        cookie: "PHPSESSID=l7cec5kqiqlt2mce3q03in0jo9",
      },
      timeout: 30000,
    }
  );
  const html = data?.html || "";
  const linkMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]+)"/i);
  return { title: "Threads Video", videoUrl: linkMatch?.[1] || null, platform: "threads" };
}
let _scClientIdCache = null;
async function getSoundCloudClientId() {
  if (_scClientIdCache) return _scClientIdCache;
  const { data: html } = await http.get("https://soundcloud.com/", {
    headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15000,
  });
  const scriptUrls = [...(html || "").matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
    .map(m => m[1]);
  for (const scriptUrl of scriptUrls.reverse()) { // آخر حزمة عادة تحتوي client_id
    try {
      const { data: js } = await http.get(scriptUrl, { timeout: 15000 });
      const match = js.match(/client_id\s*:\s*"([a-zA-Z0-9]+)"/) || js.match(/,client_id:"([a-zA-Z0-9]+)"/);
      if (match) { _scClientIdCache = match[1]; return match[1]; }
    } catch (_) { /* جرّب الحزمة التالية */ }
  }
  throw new Error("تعذّر استخراج client_id من SoundCloud");
}
async function resolveSoundCloud(url) {
  try {
    const result = await downloadMedia(url, { type: "audio" });
    return {
      title: result.title || "SoundCloud Audio",
      filePath: result.filePath,
      platform: "soundcloud",
      isFile: true,
    };
  } catch (e) {
    throw new Error(`فشل تحميل SoundCloud عبر YTDLP API: ${e.message}`);
  }
}
async function resolveSpotify(url) {
  const { data: s } = await http.get(
    `https://spotisongdownloader.to/api/composer/spotify/xsingle_track.php?url=${encodeURIComponent(url)}`
  );
  const audioUrl = s?.downloadlink || null;
  if (!audioUrl) throw new Error("تعذّر جلب رابط تحميل Spotify");
  return {
    title:     s?.song_name || "Spotify Track",
    artist:    s?.artist    || "",
    thumbnail: s?.img       || null,
    audioUrl,
    platform: "spotify",
  };
}
async function resolveSnapchat(url) {
  const { data } = await http.post(
    "https://solyptube.com/findsnapchatvideo",
    { url },
    {
      headers: {
        "content-type": "application/json",
        origin:  "https://spotlight.how2shout.com",
        referer: "https://spotlight.how2shout.com/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0 Safari/537.36",
      },
      timeout: 30000,
    }
  );
  const videoUrl = data?.data?.download_url || data?.downloadLink || data?.url;
  return { title: "Snapchat Video", videoUrl, platform: "snapchat" };
}
async function resolveCapCut(url) {
  try {
    const { data } = await http.get(`https://capcut.download/api/download?url=${encodeURIComponent(url)}`, {
      timeout: 30000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    return {
      title: data?.title || "CapCut Video",
      videoUrl: data?.video || data?.url,
      platform: "capcut"
    };
  } catch {
    throw new Error("فشل تحميل CapCut");
  }
}
async function resolveDailymotion(url) {
  const videoId = url.match(/video\/([a-zA-Z0-9]+)/)?.[1];
  if (!videoId) throw new Error("معرف Dailymotion غير صالح");
  const { data } = await http.get(`https://www.dailymotion.com/player/metadata/video/${videoId}`, {
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const qualities = ["1080", "720", "480", "360", "240"];
  let videoUrl = null;
  for (const q of qualities) {
    if (data?.qualities?.[q]?.[0]?.url) {
      videoUrl = data.qualities[q][0].url;
      break;
    }
  }
  return {
    title: data?.title || "Dailymotion Video",
    videoUrl: videoUrl || data?.qualities?.["auto"]?.[0]?.url,
    platform: "dailymotion"
  };
}
async function resolveBluesky(url) {
  const BSKY_API = "https://public.api.bsky.app/xrpc";
  const match = url.match(/bsky\.app\/profile\/([^/]+)\/post\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error("رابط Bluesky غير صالح");
  const [, handle, rkey] = match;
  let did = handle;
  if (!handle.startsWith("did:")) {
    const { data: idData } = await http.get(`${BSKY_API}/com.atproto.identity.resolveHandle`, {
      params: { handle }, timeout: 15000,
    });
    if (!idData?.did) throw new Error("تعذّر تحديد صاحب المنشور");
    did = idData.did;
  }
  const atUri = `at://${did}/app.bsky.feed.post/${rkey}`;
  const { data } = await http.get(`${BSKY_API}/app.bsky.feed.getPostThread`, {
    params: { uri: atUri },
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const embed = data?.thread?.post?.embed;
  const video = embed?.video || embed?.external?.thumb;
  return {
    title: "Bluesky Post",
    videoUrl: video?.playlist || video?.ref?.link || video?.ref || null,
    platform: "bluesky"
  };
}
async function resolveGeneric(url) {
  const { data } = await http.get("https://aminul-rest-api-three.vercel.app/downloader/alldownloader", {
    params: { url }, timeout: 40000,
  });
  const info = data?.data?.data || data?.data || data;
  if (!info) throw new Error("Generic: لا يوجد بيانات");
  const mediaUrl = info.high || info.hd || info.video || info.low || info.sd || info.url || info.audio;
  return {
    title: info.title || "وسائط",
    videoUrl: mediaUrl,
    audioUrl: info.audio || null,
    images:   info.images || info.photos || null,
    platform: "generic",
  };
}
async function resolveWithAllSiteFallback(url, platform, primary) {
  try {
    return await primary();
  } catch (primaryError) {
    try {
      console.warn(`[AUTODL] ${platform || "generic"} primary failed; trying All Site`);
      return await resolveAllSite(url, platform || "generic");
    } catch (fallbackError) {
      throw new Error(`${primaryError.message} | All Site: ${fallbackError.message}`);
    }
  }
}
async function resolveMedia(url) {
  const normalizedUrl = await normalizeMediaUrl(url);
  const platform = detectPlatform(normalizedUrl);
  switch (platform) {
    case "tiktok":      return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveTikTok(normalizedUrl));
    case "youtube":     return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveYouTube(normalizedUrl));
    case "instagram":   return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveInstagram(normalizedUrl));
    case "facebook":    return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveMetaMedia(normalizedUrl));
    case "twitter":     return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveTwitter(normalizedUrl));
    case "reddit":      return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveReddit(normalizedUrl));
    case "pinterest":   return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolvePinterest(normalizedUrl));
    case "threads":     return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveThreads(normalizedUrl));
    case "soundcloud":  return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveSoundCloud(normalizedUrl));
    case "spotify":     return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveSpotify(normalizedUrl));
    case "snapchat":    return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveSnapchat(normalizedUrl));
    case "capcut":      return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveCapCut(normalizedUrl));
    case "dailymotion": return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveDailymotion(normalizedUrl));
    case "bluesky":     return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveBluesky(normalizedUrl));
    default:            return resolveWithAllSiteFallback(normalizedUrl, platform, () => resolveGeneric(normalizedUrl));
  }
}
async function downloadImages(urls) {
  // Stream each image directly to a temp file to avoid loading
  // potentially large payloads into the V8 heap as ArrayBuffers.
  const { fetchStream } = await import("../utils/mediaStream.js");
  const files = await Promise.all(
    urls.map(async (imgUrl, i) => {
      const tmpFile = path.join(os.tmpdir(), `autodl_img_${Date.now()}_${i}.jpg`);
      const { stream } = await fetchStream(imgUrl); // SSRF-guarded + size-capped
      const writer = fs.createWriteStream(tmpFile);
      await new Promise((resolve, reject) => {
        stream.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
        stream.on("error", reject);
      });
      return tmpFile;
    })
  );
  return files;
}
async function downloadAndSend(api, event, url) {
  const { threadID, messageID } = event;
  try {
    const media = await resolveMedia(url);
    console.log(`[AUTODL] resolved: "${media.title}" | src=${url} | media=${media.videoUrl || media.audioUrl || media.imageUrl || "(file)"}`);
    if (media.isFile) {
      const ok = await sendLocalFile(api, threadID, media.filePath, media.title, messageID);
      await cleanTemp(media.filePath).catch(() => {});
      return ok;
    }
    if (Array.isArray(media.images) && media.images.length > 0) {
      const files = await downloadImages(media.images);
      await directSend(
        api, threadID,
        { attachment: files.map(f => fs.createReadStream(f)) },
        messageID
      );
      await Promise.allSettled(files.map(f => fs.remove(f)));
      return true;
    }
    if (media.imageUrl && !media.videoUrl && !media.audioUrl) {
      const tmpFile = path.join(os.tmpdir(), `autodl_img_${Date.now()}.jpg`);
      // Stream to disk — avoids V8 heap buffering for large images.
      const { fetchStream: _fetchStream } = await import("../utils/mediaStream.js");
      const { stream: _imgStream } = await _fetchStream(media.imageUrl);
      const _imgWriter = fs.createWriteStream(tmpFile);
      await new Promise((resolve, reject) => {
        _imgStream.pipe(_imgWriter);
        _imgWriter.on("finish", resolve);
        _imgWriter.on("error", reject);
        _imgStream.on("error", reject);
      });
      await directSend(api, threadID, { attachment: fs.createReadStream(tmpFile) }, messageID);
      await fs.remove(tmpFile).catch(() => {});
      return true;
    }
    if (media.audioUrl && !media.videoUrl) {
      return streamAndSend(api, threadID, media.audioUrl, "", "mp3", messageID);
    }
    const videoUrl = media.videoUrl;
    if (!videoUrl) throw new Error("لم يُعثر على رابط تحميل");
    return streamAndSend(api, threadID, videoUrl, "", "mp4", messageID);
  } catch (e) {
    console.error(`[AUTODL] ${e.message?.substring(0, 120)}`);
    return false;
  }
}
const PLATFORM_LABELS = {
  tiktok: "تيك توك",
  youtube: "يوتيوب",
  instagram: "إنستغرام",
  facebook: "فيسبوك",
  twitter: "تويتر/X",
  reddit: "ريديت",
  pinterest: "بينترست",
  threads: "ثريدز",
  soundcloud: "ساوندكلاود",
  spotify: "سبوتيفاي",
  snapchat: "سناب شات",
  capcut: "كاب كت",
  dailymotion: "ديلي موشن",
  bluesky: "بلو سكاي",
  linkedin: "لينكدإن",
  tumblr: "تمبلر",
  douyin: "دويين",
};
export default {
  config: {
    name: "autodl",
    aliases: [],
    version: "1.0.0",
    role: 0,
    countDown: 6,
    category: "وسائط وتحميل",
    description:
      "تحميل فيديو/صور/صوت من 18 منصة — يوتيوب، تيك توك، إنستغرام، فيسبوك، تويتر، ريديت، بينترست، ثريدز، سناب شات، سبوتيفاي، ساوندكلاود وأكثر.",
    usage: [
      "{pn}autodl <رابط> — تحميل يدوي",
      "أرسل الرابط مباشرة بدون أمر — اكتشاف وتحميل تلقائي",
    ],
    hidden: true,
  },
  onChat: async ({ api, event }) => {
    const url = extractUrlFromEvent(event);
    if (!url || !detectPlatform(url)) return;
    await downloadAndSend(api, event, url);
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
      global.safeSend(api, `⏳ جاري التحميل من ${label}...`, event.threadID,
        (e, i) => e ? rej(e) : res(i), event.messageID)
    ).catch(() => null);
    const ok = await downloadAndSend(api, event, url);
    if (statusMsg?.messageID) api.unsendMessage(statusMsg.messageID, event.threadID).catch(() => {});
    if (!ok) message.reply("❌ تعذّر التحميل، تأكد من الرابط أو حاول لاحقاً.");
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-media-autodl',
  meta: { category: 'command-media', path: 'src/commands/media/autodl.js' },
  setup(_ctx) {
    // see module exports
  },
};
