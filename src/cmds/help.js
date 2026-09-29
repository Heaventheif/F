const BOT_NAME = "SunkenBot";
const PAGE_MAX_LEN = 6000;
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D]|\p{Regional_Indicator}{2}/gu;

export function stripEmoji(value) {
  return String(value ?? "").replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

const CATEGORY_ORDER = [
  "ذكاء اصطناعي",
  "وسائط وتحميل",
  "مانجا وروايات",
  "ثقافة وترفيه",
  "ألعاب وترفيه",
  "أدوات عامة",
  "إدارة وإشراف",
  "أخرى",
];
const CATEGORY_RENAMES = new Map([
  ["admin", "إدارة وإشراف"],
  ["وسائط", "وسائط وتحميل"],
]);

function normalizeCategory(value) {
  const category = stripEmoji(value) || "أخرى";
  return CATEGORY_RENAMES.get(category.toLowerCase()) || category;
}

export function getLiveCommands() {
  const map = global.commands;
  if (!(map instanceof Map) || map.size === 0) return [];
  const seen = new Map();
  for (const cmd of map.values()) {
    const cfg = cmd?.config;
    if (!cfg?.name) continue;
    if (cfg.hidden || cfg.enabled === false) continue;
    if (!seen.has(String(cfg.name).toLowerCase())) seen.set(String(cfg.name).toLowerCase(), cmd);
  }
  return [...seen.values()];
}

export function toEntry(cmd) {
  const cfg = cmd?.config || {};
  const description = stripEmoji(cfg.description || "لا يوجد وصف");
  return {
    name: stripEmoji(cfg.name || ""),
    aliases: Array.isArray(cfg.aliases) ? cfg.aliases.map(stripEmoji).filter(Boolean) : [],
    desc: (description || "لا يوجد وصف").slice(0, 240),
    cat: normalizeCategory(cfg.category),
  };
}

function orderedCategories(byCat) {
  const rank = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
  return [...byCat.entries()].sort(([a], [b]) => {
    const rankA = rank.has(a) ? rank.get(a) : CATEGORY_ORDER.length;
    const rankB = rank.has(b) ? rank.get(b) : CATEGORY_ORDER.length;
    return rankA - rankB || a.localeCompare(b, "ar");
  });
}

export function buildPages(entries) {
  const byCat = new Map();
  for (const entry of entries) {
    const category = normalizeCategory(entry.cat);
    if (!byCat.has(category)) byCat.set(category, []);
    byCat.get(category).push({
      name: stripEmoji(entry.name),
      aliases: (entry.aliases || []).map(stripEmoji).filter(Boolean),
      desc: stripEmoji(entry.desc || "لا يوجد وصف").slice(0, 240),
    });
  }

  const header =
    `${BOT_NAME}\nدليل الأوامر\n${"=".repeat(24)}\n` +
    `عدد الأوامر: ${entries.length} | الأقسام: ${byCat.size}\n` +
    "اكتب «مساعدة <كلمة>» للبحث بالاسم أو البديل أو الوصف.\n\n";
  const footer = "\nللبحث عن أمر: مساعدة <كلمة>\nمثال: مساعدة يوتيوب";
  const pages = [];
  let current = header;
  let number = 0;

  const pushPage = () => {
    pages.push(`${current.trimEnd()}\nتابع القائمة في الرسالة التالية.`);
    current = header;
  };

  for (const [category, commands] of orderedCategories(byCat)) {
    commands.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    const categoryHeader = `${category} (${commands.length})\n${"─".repeat(24)}\n`;
    if (current.length + categoryHeader.length + footer.length > PAGE_MAX_LEN && current !== header) {
      pushPage();
    }
    current += categoryHeader;

    for (const command of commands) {
      number += 1;
      const aliases = command.aliases.length ? ` (البدائل: ${command.aliases.join("، ")})` : "";
      const block = `${String(number).padStart(2, "0")}. ${command.name}${aliases}\n   ${command.desc || "لا يوجد وصف"}\n`;
      if (current.length + block.length + footer.length > PAGE_MAX_LEN && current !== header) {
        pushPage();
        current += categoryHeader;
      }
      current += block;
    }
    current += "\n";
  }

  current += footer;
  pages.push(current.trim());
  return pages;
}

function searchEntries(entries, query) {
  return entries.filter((command) =>
    command.name.toLowerCase().includes(query) ||
    command.aliases.some((alias) => alias.toLowerCase().includes(query)) ||
    command.desc.toLowerCase().includes(query) ||
    command.cat.toLowerCase().includes(query),
  );
}

// Resolve safeSend at runtime because the bot enhancer registers it after loading commands.
function send(api, text, threadID, replyToID) {
  const safeSend = typeof global.safeSend === "function" ? global.safeSend : null;
  if (safeSend) return safeSend(api, text, threadID, null, replyToID);
  return api.sendMessage(text, threadID, replyToID).catch((error) => {
    console.error("[help] " + error.message);
    return null;
  });
}

export default {
  config: {
    name: "help",
    aliases: ["اوامر", "مساعدة"],
    version: "4.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    category: "أدوات عامة",
    description: "قائمة الأوامر مرتبة حسب الفئات مع وصف وبحث بالاسم أو البديل أو الوصف",
    usage: [
      "{pn}مساعدة — عرض قائمة الأوامر",
      "{pn}مساعدة <كلمة> — البحث في الأوامر",
    ],
  },
  onStart: async ({ api, event, args }) => {
    const entries = getLiveCommands().map(toEntry);
    if (!entries.length) {
      await send(api, "تعذر جلب قائمة الأوامر حالياً. حاول مرة أخرى لاحقاً.", event.threadID, event.messageID);
      return;
    }

    const query = stripEmoji((args || []).join(" ")).toLowerCase();
    if (query) {
      const results = searchEntries(entries, query);
      if (results.length === 0) {
        await send(api, `لم يعثر على أوامر تطابق «${query}». جرّب كلمة أخرى.`, event.threadID, event.messageID);
        return;
      }
      const body = results
        .map((command, index) => {
          const aliases = command.aliases.length ? ` (البدائل: ${command.aliases.join("، ")})` : "";
          return `${String(index + 1).padStart(2, "0")}. ${command.name}${aliases} — ${command.cat}\n   ${command.desc}`;
        })
        .join("\n");
      await send(api, `نتائج البحث عن «${query}» (${results.length})\n${"─".repeat(24)}\n${body}`, event.threadID, event.messageID);
      return;
    }

    const pages = buildPages(entries);
    let replyToID = event.messageID || null;
    for (const page of pages) {
      const result = await send(api, page, event.threadID, replyToID);
      replyToID = result?.messageID || null;
    }
  },
};

/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-general-help",
  meta: { category: "command-general", path: "src/commands/general/help.js" },
  setup(_ctx) {
    // see module exports
  },
};
