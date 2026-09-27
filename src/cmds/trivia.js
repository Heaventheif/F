import { getFahimTrivia } from "../utils/fahimProviders.js";
import { toArabicOutputBatch } from "../utils/arabicOutput.js";

const OPTION_LABELS = ["أ", "ب", "ج", "د", "هـ", "و"];

export default {
  config: {
    name: "trivia",
    aliases: ["سؤال"],
    version: "1.0.0",
    role: 0,
    countDown: 5,
    category: "ثقافة وترفيه",
    description: "يعرض سؤال معلومات عامة وخياراته وإجابته بالعربية",
    usage: ["{pn}trivia — سؤال معلومات عامة", "{pn}سؤال — نفس الأمر بالعربية"],
  },
  onStart: async ({ message }) => {
    try {
      const item = await getFahimTrivia();
      const fields = [item.question, ...item.options];
      const arabic = await toArabicOutputBatch(fields);
      const question = arabic[0];
      const options = arabic.slice(1, -1);
      const answer = arabic.at(-1);
      const choices = options.map((value, index) => ` ${OPTION_LABELS[index] || index + 1}) ${value}`).join("\n");
      return message.reply(`🧠 سؤال معلومات عامة\n\n${question}\n${choices}\n\n✅ الإجابة الصحيحة: ${answer}`);
    } catch (error) {
      console.warn("[TRIVIA] تعذر جلب السؤال:", error.message);
      return message.reply("تعذر جلب سؤال عربي الآن؛ حاول مرة أخرى لاحقاً.");
    }
  },
};

/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-fun-trivia",
  meta: { category: "command-fun", path: "src/commands/fun/trivia.js" },
  setup(_ctx) {},
};
