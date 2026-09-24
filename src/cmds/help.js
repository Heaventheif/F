const BOT_NAME = "𝗦𝘂𝗻𝗸𝗲𝗻𝗕𝗼𝘁";
const PAGE_MAX_LEN = 7000; 
function getLiveCommands() {
  const map = global.commands;
  if (!(map instanceof Map) || map.size === 0) return [];
  const seen = new Map(); 
  for (const cmd of map.values()) {
    const cfg = cmd?.config;
    if (!cfg?.name) continue;
    if (cfg.hidden || cfg.enabled === false) continue;
    if (!seen.has(cfg.name)) seen.set(cfg.name, cmd);
  }
  return [...seen.values()];
}
function toEntry(cmd) {
  const cfg = cmd.config || {};
  return {
    name: String(cfg.name || ""),
    aliases: Array.isArray(cfg.aliases) ? cfg.aliases.map(String) : [],
    desc: String(cfg.description || "بدون وصف"),
    cat: String(cfg.category || "أخرى"),
  };
}
const CATEGORY_ICONS = {
  "أدوات عامة": "🧰",
  "إدارة وإشراف": "🛡️",
  "ذكاء اصطناعي": "🤖",
  "وسائط وتحميل": "🎬",
  "ألعاب وترفيه": "🎮",
  "مانجا وروايات": "📖",
};
const DEFAULT_ICON = "📂";
function buildPages(entries) {
  const byCat = new Map();
  for (const e of entries) {
    if (!byCat.has(e.cat)) byCat.set(e.cat, []);
    byCat.get(e.cat).push(e);
  }
  const header =
    `┏━━━━━━━━━━━━━━━━━━━┓\n┃  ✦ ${BOT_NAME} ✦\n┃  دليل الأوامر الكامل\n┗━━━━━━━━━━━━━━━━━━━┛\n` +
    `📌 ${entries.length} أمرًا في ${byCat.size} أقسام │ اكتب اسم الأمر أو بديله لإطلاقه\n\n`;
  const footer =
    `\n💡 تلميح: ابحث بكتابة «مساعدة + كلمة» (اسم/بديل/جزء من الوصف)\n` +
    `   مثال: «مساعدة يوتيوب»\n\n⌁ ${BOT_NAME} — بوت المانجا والروايات والذكاء الاصطناعي`;
  let block = "";
  let n = 0;
  for (const [cat, cmds] of byCat) {
    const icon = CATEGORY_ICONS[cat] || DEFAULT_ICON;
    block += `${icon} ${cat} (${cmds.length})\n${"─".repeat(22)}\n`;
    for (const c of cmds) {
      n++;
      const aliasTxt = c.aliases.length ? `${c.name}  ·  ${c.aliases.join("، ")}` : c.name;
      block += `${String(n).padStart(2, "0")}. ${aliasTxt}\n`;
    }
    block += "\n";
  }
  const pages = [];
  const lines = block.split("\n");
  let cur = header;
  for (const line of lines) {
    const chunk = line + "\n";
    if (cur.length + chunk.length + footer.length > PAGE_MAX_LEN && cur !== header) {
      pages.push(cur.trim());
      cur = "";
    }
    cur += chunk;
  }
  cur += footer;
  pages.push(cur.trim());
  return pages;
}
function searchEntries(entries, q) {
  return entries.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.aliases.some((a) => a.toLowerCase().includes(q)) ||
      c.desc.toLowerCase().includes(q),
  );
}
// safeSend يُحلّ في وقت التنفيذ لا في وقت التحميل
// (bot-enhancer يُسجّله بعد تحميل الأوامر، لذا يجب التحقق داخل كل handler)
function S(api, text, threadID, _unused, replyToID) {
  const ss = typeof global.safeSend === "function" ? global.safeSend : null;
  if (ss) return ss(api, text, threadID, null, replyToID);
  return api.sendMessage(text, threadID, replyToID).catch(e => {
    console.error("[help] " + e.message);
    return null;
  });
}
export default {
  config: {
    name: "help",
    aliases: ["اوامر", "مساعدة"],
    version: "3.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    category: "أدوات عامة",
    description: "دليل الأوامر الكامل مرتبًا بالفئات مع وصف لكل أمر وبدائله + بحث مدمج (مبني ديناميكيًا من الأوامر المسجّلة فعليًا)",
    usage: [
      "{pn}مساعدة — عرض دليل الأوامر كاملًا",
      "{pn}مساعدة — كلمة — البحث في الأوامر (بالاسم أو البديل أو جزء من الوصف)",
    ],
  },
  onStart: async ({ api, event, args }) => {
    const entries = getLiveCommands().map(toEntry);
    if (!entries.length) {
      await S(api, "⚠️ تعذّر جلب قائمة الأوامر حاليًا — حاول لاحقًا.", event.threadID, null, event.messageID);
      return;
    }
    const q = (args || []).join(" ").trim().toLowerCase();
    if (q) {
      const results = searchEntries(entries, q);
      if (results.length === 0) {
        await S(api, "لم يعثر على أوامر تطابق «" + q + "» — جرّب كلمة أخرى", event.threadID, null, event.messageID);
        return;
      }
      const txt =
        `🔍 نتائج البحث عن «${q}» (${results.length})\n${"─".repeat(22)}\n` +
        results.map((c, i) => `${String(i + 1).padStart(2, "0")}. ${c.name}${c.aliases.length ? `  ·  ${c.aliases.join("، ")}` : ""}\n    ↳ ${c.desc}`).join("\n");
      await S(api, txt, event.threadID, null, event.messageID);
      return;
    }
    const pages = buildPages(entries);
    let lastId = event.messageID || null;
    for (const page of pages) {
      const res = await S(api, page, event.threadID, null, lastId);
      lastId = res?.messageID || null;
    }
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-general-help',
  meta: { category: 'command-general', path: 'src/commands/general/help.js' },
  setup(_ctx) {
    // see module exports
  },
};
