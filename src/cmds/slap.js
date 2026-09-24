"use strict";
import http from "../utils/fetchHttp.js";
import fs from "fs-extra";
import os from "os";
import path from "path";
const BASE_URL = "https://betadash-api-swordslush-production.up.railway.app";
const SLAP_APIS = [
  { endpoint: "spank",  label: "🍑 Spank",  param1: "uid1",     param2: "uid2" },
  { endpoint: "slapv2", label: "👊 Slap V2", param1: "one",      param2: "two" },
  { endpoint: "slap",   label: "🦇 Slap",    param1: "batman",   param2: "superman" },
];
const ROTATION_KEY = "slap_rotation_index";
function getNextApi(globalData) {
  let idx = 0;
  if (globalData) {
    idx = globalData.get(ROTATION_KEY);
    if (typeof idx !== "number" || idx < 0 || idx >= SLAP_APIS.length) idx = 0;
  }
  const api = SLAP_APIS[idx];
  const nextIdx = (idx + 1) % SLAP_APIS.length;
  if (globalData) globalData.set(ROTATION_KEY, nextIdx);
  return api;
}
export default {
  config: {
    name: "slap",
    aliases: ["صفعة", "سلاب"],
    version: "1.0.0",
    role: 0,
    countDown: 10,
    category: "ألعاب وترفيه",
    description: "يرسم صورة صفع بين شخصين بأسلوب فني عشوائي بالتناوب (Round-Robin) بين عدة تصاميم",
    usage: [
      "رد على رسالة الشخص + {pn}slap — يصفعه مُرسل الأمر بالتصميم التالي في الدور",
      "{pn}slap @منشن — يصفع الشخص الذي تم منشنته",
      "{pn}slap <UID> — يصفع صاحب هذا الـ UID مباشرة",
      "{pn}slap list — يعرض كل التصاميم المتاحة وترتيب الدور الحالي",
    ],
  },
  onStart: async ({ api, event, args, message, globalData }) => {
    const { threadID, messageID, senderID, mentions, messageReply } = event;
    if ((args[0] || "").toLowerCase() === "list" || args[0] === "قائمة") {
      const current = globalData && typeof globalData.get(ROTATION_KEY) === "number"
        ? globalData.get(ROTATION_KEY)
        : 0;
      const lines = SLAP_APIS.map((c, i) =>
        `${i === current ? "👉" : "  "} ${i + 1}. ${c.label}`
      );
      return message.reply(
        `🎨 تصاميم slap المتاحة (${SLAP_APIS.length}):\n\n${lines.join("\n")}\n\n` +
        `السهم 👉 يشير إلى التصميم الذي سيُستخدم في المرة القادمة.`
      );
    }
    const id1 = senderID;
    let id2;
    const mentionIDs = Object.keys(mentions || {});
    if (mentionIDs.length > 0) {
      id2 = mentionIDs[0];
    } else if (messageReply?.senderID) {
      id2 = messageReply.senderID;
    } else if (args[0] && /^\d{5,20}$/.test(args[0])) {
      id2 = args[0];
    }
    if (!id2) {
      return message.reply(
        "⚠️ حدد الشخص الذي تريد صفعه: رد على رسالته، أو منشنه، أو اكتب الـ UID الخاص به."
      );
    }
    const chosen = getNextApi(globalData);
    let tmpFile;
    try {
      const res = await http.get(`${BASE_URL}/${chosen.endpoint}`, {
        params: { [chosen.param1]: id1, [chosen.param2]: id2 },
        responseType: "arraybuffer",
        timeout: 30000,
      });
      tmpFile = path.join(os.tmpdir(), `slap_${chosen.endpoint}_${id1}_${id2}_${Date.now()}.png`);
      await fs.writeFile(tmpFile, res.data);
      await global.safeSend(
        api,
        { body: chosen.label, attachment: fs.createReadStream(tmpFile) },
        threadID, null, messageID
      );
    } catch (error) {
      console.error("[SLAP]", chosen.endpoint, error?.response?.status, error.message);
      await message.reply(`❌ حدث خطأ أثناء توليد صورة "${chosen.label}"، حاول مرة أخرى لاحقاً.`);
    } finally {
      if (tmpFile) fs.remove(tmpFile).catch(() => {});
    }
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-fun-slap',
  meta: { category: 'command-fun', path: 'src/commands/fun/slap.js' },
  setup(_ctx) {
    // see module exports
  },
};
