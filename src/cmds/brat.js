"use strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fetchImageWithFallback, formatProviderError, validateText } from "../utils/betadash.js";
export default {
  config: { name: "brat", aliases: ["برات"], version: "1.0.0", role: 0, countDown: 8, category: "وسائط", description: "تحويل نص قصير إلى صورة Brat", usage: ["{pn}brat <نص>"] },
  onStart: async ({ api, event, args, message }) => {
    const text = validateText(args.join(" "));
    if (!text) return message.reply("⚠️ اكتب نصاً قصيراً بعد الأمر (حتى 180 حرفاً).");
    try {
      const result = await fetchImageWithFallback([{ endpoint: "brat", params: { text } }]);
      const file = path.join(os.tmpdir(), `brat_${Date.now()}.png`);
      try { await fs.writeFile(file, result.data); await global.safeSend(api, { body: "📝 Brat", attachment: fs.createReadStream(file) }, event.threadID, null, event.messageID); }
      finally { await fs.remove(file).catch(() => {}); }
    } catch (error) { console.error("[BRAT]", error.details || error.message); await message.reply(`❌ ${formatProviderError(error)}`); }
  },
};
export const $plugin = { name: "xx-commands-media-brat", meta: { category: "command-media", path: "src/commands/media/brat.js" }, setup() {} };
