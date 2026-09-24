"use strict";
import http from "../utils/fetchHttp.js";
import fs from "fs-extra";
import os from "os";
import path from "path";
const BASE_URL = "https://betadash-api-swordslush-production.up.railway.app";
const CANVAS_APIS = [
  { endpoint: "brick-wall",       label: "🧱 Brick Wall" },
  { endpoint: "odessa",           label: "🏛️ Odessa" },
  { endpoint: "obama",            label: "🎩 Obama" },
  { endpoint: "new-york-street",  label: "🗽 New York Street" },
  { endpoint: "london-calling",   label: "🚌 London Calling" },
  { endpoint: "london-gallery",   label: "🖼️ London Gallery" },
  { endpoint: "Lafayette",        label: "🏢 Lafayette" },
  { endpoint: "latte-art",        label: "☕ Latte Art" },
  { endpoint: "blink",            label: "✨ Blink" },
  { endpoint: "big-screen",       label: "📺 Big Screen" },
  { endpoint: "beautiful",        label: "🖼️ Beautiful" },
  { endpoint: "artist",           label: "🎨 Artist" },
  { endpoint: "art-expert",       label: "🧐 Art Expert" },
  { endpoint: "affect",           label: "😂 Affect" },
  { endpoint: "adpic",            label: "📰 Ad Pic" },
  { endpoint: "city-billboard",   label: "🏙️ City Billboard" },
  { endpoint: "city-light",       label: "🌃 City Light" },
  { endpoint: "broadway",         label: "🎭 Broadway" },
  { endpoint: "calendar",         label: "📅 Calendar" },
  { endpoint: "cafe",             label: "☕ Cafe" },
];
const ROTATION_KEY = "canva_rotation_index";
function getNextApi(globalData) {
  let idx = 0;
  if (globalData) {
    idx = globalData.get(ROTATION_KEY);
    if (typeof idx !== "number" || idx < 0 || idx >= CANVAS_APIS.length) idx = 0;
  }
  const api = CANVAS_APIS[idx];
  const nextIdx = (idx + 1) % CANVAS_APIS.length;
  if (globalData) globalData.set(ROTATION_KEY, nextIdx);
  return api;
}
export default {
  config: {
    name: "canva",
    aliases: ["لوحة"],
    version: "1.0.0",
    role: 0,
    countDown: 3,
    category: "ألعاب وترفيه",
    description: "يرسم صورة بروفايل شخص بأسلوب فني عشوائي بالتناوب (Round-Robin) بين عدة تصاميم",
    usage: [
      "رد على رسالة الشخص + {pn}canva — يرسم صورة بروفايل صاحب الرسالة بالتصميم التالي في الدور",
      "{pn}canva @منشن — يرسم صورة بروفايل الشخص الذي تم منشنته",
      "{pn}canva <UID> — يرسم صورة بروفايل صاحب هذا الـ UID مباشرة",
      "{pn}canva — يرسم صورة بروفايلك أنت",
      "{pn}canva list — يعرض كل التصاميم المتاحة وترتيب الدور الحالي",
    ],
  },
  onStart: async ({ api, event, args, message, globalData }) => {
    const { threadID, messageID, senderID, mentions, messageReply } = event;
    if ((args[0] || "").toLowerCase() === "list" || args[0] === "قائمة") {
      const current = globalData && typeof globalData.get(ROTATION_KEY) === "number"
        ? globalData.get(ROTATION_KEY)
        : 0;
      const lines = CANVAS_APIS.map((c, i) =>
        `${i === current ? "👉" : "  "} ${i + 1}. ${c.label}`
      );
      return message.reply(
        `🎨 تصاميم canva المتاحة (${CANVAS_APIS.length}):\n\n${lines.join("\n")}\n\n` +
        `السهم 👉 يشير إلى التصميم الذي سيُستخدم في المرة القادمة.`
      );
    }
    let targetID;
    const mentionIDs = Object.keys(mentions || {});
    if (mentionIDs.length > 0) {
      targetID = mentionIDs[0];
    } else if (messageReply?.senderID) {
      targetID = messageReply.senderID;
    } else if (args[0] && /^\d{5,20}$/.test(args[0])) {
      targetID = args[0];
    } else {
      targetID = senderID;
    }
    const chosen = getNextApi(globalData);
    let tmpFile;
    try {
      const res = await http.get(`${BASE_URL}/${chosen.endpoint}`, {
        params: { userid: targetID },
        responseType: "arraybuffer",
        timeout: 30000,
      });
      tmpFile = path.join(os.tmpdir(), `canva_${chosen.endpoint}_${targetID}_${Date.now()}.png`);
      await fs.writeFile(tmpFile, res.data);
      await global.safeSend(
        api,
        { body: chosen.label, attachment: fs.createReadStream(tmpFile) },
        threadID, null, messageID
      );
    } catch (error) {
      console.error("[CANVA]", chosen.endpoint, error?.response?.status, error.message);
      await message.reply(`❌ حدث خطأ أثناء توليد صورة "${chosen.label}"، حاول مرة أخرى لاحقاً.`);
    } finally {
      if (tmpFile) fs.remove(tmpFile).catch(() => {});
    }
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-media-canva',
  meta: { category: 'command-media', path: 'src/commands/media/canva.js' },
  setup(_ctx) {
    // see module exports
  },
};
