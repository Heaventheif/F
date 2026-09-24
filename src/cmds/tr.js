import http from "../utils/fetchHttp.js";
export default {
  config: {
    name: "tr",
    description: "ترجمة النص إلى أي لغة",
    usage: [
      "{pn}ترجمة1 <رمز_اللغة> <النص> — مثال: {pn}ترجمة1 en مرحبا",
      "رد على رسالة + {pn}ترجمة1 <رمز_اللغة> — ترجمة نص الرسالة المردود عليها",
    ],
    aliases: ["ترجم"],
    category: "أدوات عامة",
    role: 0,
    countDown: 5,
    nonPrefix: true
  },
  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID, messageReply, body } = event;
    const knownLangCodes = [
      "ar","en","fr","es","de","it","pt","ru","zh","zh-cn","zh-tw","ja","ko",
      "tr","nl","pl","sv","fi","da","no","el","he","hi","ur","fa","id","ms",
      "th","vi","ro","hu","cs","sk","uk","bg","sr","hr","sl","lt","lv","et",
      "az","ka","am","sw","bn","ta","te","ml","mr","gu","pa","ne","si","km",
      "lo","my","mn","kk","uz","tg","ps","ku","yo","ig","ha","zu","xh","af",
      "sq","hy","eu","be","bs","ca","cy","eo","fy","ga","gl","is","jw","kn",
      "la","lb","mg","mi","mk","mt","ny","or","rw","sd","sm","sn","so","st",
      "su","tl","tt","ug","yi"
    ];
    let targetLang;
    let textToTranslate = "";
    if (args.length === 0) {
      if (messageReply && messageReply.body) {
        targetLang = "ar";
        textToTranslate = messageReply.body;
      } else {
        return global.safeSend(api, "❌ الرجاء كتابة النص أو الرد على رسالة لترجمتها\nأو: ترجمة1 <رمز_اللغة> <النص>", threadID, null, messageID);
      }
    } else if (knownLangCodes.includes(args[0].toLowerCase()) && (args.length > 1 || (messageReply && messageReply.body))) {
      targetLang = args[0].toLowerCase();
      if (args.length > 1) {
        textToTranslate = args.slice(1).join(" ");
      } else {
        textToTranslate = messageReply.body;
      }
    } else {
      targetLang = "ar";
      textToTranslate = args.join(" ");
    }
    try {
      const response = await http.get(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(textToTranslate)}`,
        { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const result = response.data;
      if (!Array.isArray(result) || !Array.isArray(result[0])) {
        throw new Error("استجابة غير متوقعة من خدمة الترجمة، حاول لاحقاً.");
      }
      let translatedText = "";
      result[0].forEach(item => {
        if (item?.[0]) translatedText += item[0];
      });
      if (!translatedText) throw new Error("لم تُرجع الترجمة أي نص.");
      await global.safeSend(api, translatedText, threadID, null, messageID);
    } catch (error) {
      const msg = error.code === "ECONNABORTED" || error.message?.includes("timeout")
        ? "⏱️ انتهت مهلة الاتصال بخدمة الترجمة"
        : `❌ خطأ في الترجمة: ${error.message}`;
      await global.safeSend(api, msg, threadID, null, messageID);
    }
  }
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-ai-tr',
  meta: { category: 'command-ai', path: 'src/commands/ai/tr.js' },
  setup(_ctx) {
    // see module exports
  },
};
