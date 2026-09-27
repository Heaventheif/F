import { getFahimJoke } from "../utils/fahimProviders.js";
import { toArabicOutput } from "../utils/arabicOutput.js";

export default {
  config: {
    name: "joke",
    aliases: ["نكتة"],
    version: "1.0.0",
    role: 0,
    countDown: 5,
    category: "ثقافة وترفيه",
    description: "يعرض نكتة قصيرة مترجمة إلى العربية",
    usage: ["{pn}joke — نكتة عشوائية", "{pn}نكتة — نفس الأمر بالعربية"],
  },
  onStart: async ({ message }) => {
    try {
      const joke = await toArabicOutput(await getFahimJoke());
      return message.reply(`😄 نكتة:\n${joke}`);
    } catch (error) {
      console.warn("[JOKE] تعذر جلب النكتة:", error.message);
      return message.reply("تعذر جلب نكتة عربية الآن؛ حاول مرة أخرى لاحقاً.");
    }
  },
};

/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-fun-joke",
  meta: { category: "command-fun", path: "src/commands/fun/joke.js" },
  setup(_ctx) {},
};
