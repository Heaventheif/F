import fs from "fs-extra";
import path from "node:path";
import { downloadMedia, directSend, directSendParts, splitFile, cleanupParts, NEEDS_SPLIT } from "../src/utils/media.js";
import { checkCooldown, setCooldown } from "../src/utils/access.js";
const URL_RE = /https?:\/\/[^\s"'<>]+/i;
const YTDLP_API_LABEL = "YTDLP API";
const AUTO_ENABLED = !["off", "0", "false", "no"].includes(String(process.env.AUTODL_AUTO ?? "on").trim().toLowerCase());
const AUTO_HOSTS = new Set([
  "youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com",
  "instagram.com", "www.instagram.com",
]);
const AUTO_MAX = 1;
let _autoInFlight = 0;
const hostAllowed = (u) => { try { return AUTO_HOSTS.has(new URL(u).hostname.toLowerCase()); } catch { return false; } };
function extractUrl(text) {
  return String(text || "").match(URL_RE)?.[0]?.replace(/[.,)]+$/, "") || null;
}
function extractUrlFromEvent(event) {
  return extractUrl(event?.body) || extractUrl(event?.messageReply?.body);
}
function parseDownloadType(args = []) {
  const normalized = args.map(value => String(value).toLowerCase());
  return normalized.includes("audio") || normalized.includes("mp3") ? "audio" : "video";
}
async function sendLocalFile(api, threadID, filePath, title, replyToID) {
  try {
    const stat = await fs.stat(filePath);
    const extension = path.extname(filePath).slice(1) || "mp4";
    if (NEEDS_SPLIT(stat.size)) {
      const parts = await splitFile(filePath, extension);
      try {
        const streams = parts.map(part => ({
          stream: fs.createReadStream(part),
          reopen: () => fs.createReadStream(part)
        }));
        const result = await directSendParts(api, threadID, title, streams, replyToID);
        return result.sent > 0;
      } finally {
        await cleanupParts(parts);
        await fs.remove(filePath).catch(() => {});
      }
    }
    const sent = await directSend(api, threadID, {
      attachment: fs.createReadStream(filePath)
    }, replyToID);
    await fs.remove(filePath).catch(() => {});
    return sent;
  } catch (error) {
    await fs.remove(filePath).catch(() => {});
    console.error("[AUTODL:SEND]", error?.message || error);
    return false;
  }
}
async function downloadAndSend(api, event, url, type = "video") {
  const { threadID, messageID } = event;
  let media;
  try {
    media = await downloadMedia(url, { type, q: type === "audio" ? 128 : 720 });
    console.log(`[AUTODL] provider=${YTDLP_API_LABEL} type=${type} url=${url}`);
    return await sendLocalFile(api, threadID, media.filePath, media.title || "وسائط", messageID);
  } catch (error) {
    if (media?.filePath) await fs.remove(media.filePath).catch(() => {});
    console.error(`[AUTODL:${YTDLP_API_LABEL}]`, error?.message || error);
    return false;
  }
}
function sendStatus(api, threadID, text, replyToID) {
  return new Promise(resolve => {
    global.safeSend(api, text, threadID, (error, info) => resolve(error ? null : info || null), replyToID);
  });
}
export default {
  config: {
    name: "autodl",
    aliases: ["download"],
    version: "2.0.0",
    role: 0,
    countDown: 6,
    category: "وسائط وتحميل",
    description: "تحميل الفيديو أو الصوت من رابط واحد عبر YTDLP API.",
    usage: [
      "{pn}autodl <رابط> — تحميل فيديو عبر YTDLP API",
      "{pn}autodl audio <رابط> — تحميل صوت عبر YTDLP API",
      "أرسل الرابط مباشرة بدون أمر — اكتشاف وتحميل تلقائي (مفعّل افتراضياً — لإيقافه AUTODL_AUTO=off)"
    ],
    hidden: true
  },
  onChat: async ({ api, event }) => {
    if (!AUTO_ENABLED) return;
    const url = extractUrl(event?.body);
    if (!url || !hostAllowed(url)) return;
    const uid = String(event.senderID);
    if (checkCooldown(uid, "autodl:auto") || _autoInFlight >= AUTO_MAX) return;
    setCooldown(uid, "autodl:auto", 60);
    _autoInFlight++;
    try { await downloadAndSend(api, event, url, "video"); }
    finally { _autoInFlight--; }
  },
  onStart: async ({ api, event, args, message }) => {
    const values = [...args];
    const type = parseDownloadType(values);
    const url = values.find(value => /^https?:\/\//i.test(String(value))) || extractUrl(values.join(" "));
    if (!url) return message.reply("📥 الاستخدام: autodl <رابط>\nوللصوت: autodl audio <رابط>");
    const status = await sendStatus(api, event.threadID, `⏳ جاري التحميل عبر ${YTDLP_API_LABEL}...`, event.messageID);
    const ok = await downloadAndSend(api, event, url, type);
    if (status?.messageID) await api.unsendMessage(status.messageID, event.threadID).catch(() => {});
    if (!ok) await message.reply("❌ تعذّر التحميل عبر YTDLP API، تأكد من الرابط وحاول لاحقاً.");
  }
};
export { extractUrl, extractUrlFromEvent, parseDownloadType, downloadAndSend };
