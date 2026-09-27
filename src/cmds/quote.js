import { getFahimAdvice } from "../utils/fahimProviders.js";
import { toArabicOutput } from "../utils/arabicOutput.js";

export default {
  config: {
    name: "quote",
    aliases: ["نصيحة"],
    version: "1.0.0",
    role: 0,
    countDown: 5,
    category: "ثقافة وترفيه",
    description: "يعرض نصيحة قصيرة باللغة العربية",
    usage: ["{pn}quote — نصيحة عشوائية", "{pn}نصيحة — نفس الأمر بالعربية"],
  },
  onStart: async ({ message }) => {
    try {
      const advice = await toArabicOutput(await getFahimAdvice());
      return message.reply(`🌱 نصيحة اليوم:\n${advice}`);
    } catch (error) {
      console.warn("[QUOTE] تعذر جلب النصيحة:", error.message);
      return message.reply("تعذر جلب نصيحة عربية الآن؛ حاول مرة أخرى لاحقاً.");
    }
  },
};

/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-fun-quote",
  meta: { category: "command-fun", path: "src/commands/fun/quote.js" },
  setup(_ctx) {},
};
