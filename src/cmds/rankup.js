"use strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fetchImageWithFallback, formatProviderError, validateUserId } from "../utils/betadash.js";
export default {
  config: { name: "rankup", aliases: ["رتبة"], version: "1.0.0", role: 0, countDown: 10, category: "ألعاب وترفيه", description: "بطاقة رتبة متحركة لصورة بروفايلك", usage: ["{pn}rankup", "{pn}rankup @منشن"] },
  onStart: async ({ api, event, message }) => {
    const id = validateUserId(Object.keys(event.mentions || {})[0] || event.messageReply?.senderID || event.senderID);
    if (!id) return message.reply("⚠️ تعذر تحديد UID صالح.");
    try {
      const result = await fetchImageWithFallback([{ endpoint: "api/rankup", params: { uid: id } }, { endpoint: "rankup", params: { uid: id } }]);
      const file = path.join(os.tmpdir(), `rankup_${Date.now()}.png`);
      try { await fs.writeFile(file, result.data); await global.safeSend(api, { body: "🏆 Rank Up", attachment: fs.createReadStream(file) }, event.threadID, null, event.messageID); }
      finally { await fs.remove(file).catch(() => {}); }
    } catch (error) { console.error("[RANKUP]", error.details || error.message); await message.reply(`❌ ${formatProviderError(error)}`); }
  },
};
export const $plugin = { name: "xx-commands-fun-rankup", meta: { category: "command-fun", path: "src/commands/fun/rankup.js" }, setup() {} };
