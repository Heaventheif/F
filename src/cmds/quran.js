import http from "../utils/fetchHttp.js";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { directSend } from "../utils/directSend.js";
const execFileAsync = promisify(execFile);
const MP3QURAN_API = "https://www.mp3quran.net/api/v3";
const SURAHS = [
  ["الفاتحة"],
  ["البقرة"],
  ["آل عمران", "ال عمران"],
  ["النساء"],
  ["المائدة"],
  ["الأنعام", "الانعام"],
  ["الأعراف", "الاعراف"],
  ["الأنفال", "الانفال"],
  ["التوبة", "براءة"],
  ["يونس"],
  ["هود"],
  ["يوسف"],
  ["الرعد"],
  ["إبراهيم", "ابراهيم"],
  ["الحجر"],
  ["النحل"],
  ["الإسراء", "الاسراء", "بني إسرائيل"],
  ["الكهف"],
  ["مريم"],
  ["طه"],
  ["الأنبياء", "الانبياء"],
  ["الحج"],
  ["المؤمنون", "المومنون"],
  ["النور"],
  ["الفرقان"],
  ["الشعراء"],
  ["النمل"],
  ["القصص"],
  ["العنكبوت"],
  ["الروم"],
  ["لقمان"],
  ["السجدة"],
  ["الأحزاب", "الاحزاب"],
  ["سبأ", "سبا"],
  ["فاطر"],
  ["يس"],
  ["الصافات"],
  ["ص"],
  ["الزمر"],
  ["غافر"],
  ["فصلت"],
  ["الشورى"],
  ["الزخرف"],
  ["الدخان"],
  ["الجاثية"],
  ["الأحقاف", "الاحقاف"],
  ["محمد"],
  ["الفتح"],
  ["الحجرات"],
  ["ق"],
  ["الذاريات"],
  ["الطور"],
  ["النجم"],
  ["القمر"],
  ["الرحمن"],
  ["الواقعة"],
  ["الحديد"],
  ["المجادلة"],
  ["الحشر"],
  ["الممتحنة"],
  ["الصف"],
  ["الجمعة"],
  ["المنافقون"],
  ["التغابن"],
  ["الطلاق"],
  ["التحريم"],
  ["الملك"],
  ["القلم"],
  ["الحاقة"],
  ["المعارج"],
  ["نوح"],
  ["الجن"],
  ["المزمل"],
  ["المدثر"],
  ["القيامة"],
  ["الإنسان", "الانسان", "الدهر"],
  ["المرسلات"],
  ["النبأ", "النبا"],
  ["النازعات"],
  ["عبس"],
  ["التكوير"],
  ["الانفطار"],
  ["المطففين"],
  ["الانشقاق"],
  ["البروج"],
  ["الطارق"],
  ["الأعلى", "الاعلى"],
  ["الغاشية"],
  ["الفجر"],
  ["البلد"],
  ["الشمس"],
  ["الليل"],
  ["الضحى"],
  ["الشرح", "الانشراح"],
  ["التين"],
  ["العلق"],
  ["القدر"],
  ["البينة"],
  ["الزلزلة"],
  ["العاديات"],
  ["القارعة"],
  ["التكاثر"],
  ["العصر"],
  ["الهمزة"],
  ["الفيل"],
  ["قريش"],
  ["الماعون"],
  ["الكوثر"],
  ["الكافرون"],
  ["النصر"],
  ["المسد", "اللهب"],
  ["الإخلاص", "الاخلاص"],
  ["الفلق"],
  ["الناس"],
];
function normalizeArabic(text) {
  return text
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}
const SURAH_NAME_INDEX = new Map();
SURAHS.forEach((names, i) => {
  const surahNumber = i + 1;
  for (const name of names) {
    SURAH_NAME_INDEX.set(normalizeArabic(name), surahNumber);
    const normalized = normalizeArabic(name);
    if (normalized.startsWith("ال")) {
      SURAH_NAME_INDEX.set(normalized.slice(2), surahNumber);
    }
  }
});
/**
 * يحاول تحويل نص (اسم سورة أو رقمها) إلى رقم سورة صالح (1-114).
 * يعيد null إن تعذّرت المطابقة.
 */
function resolveSurahNumber(raw) {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return n >= 1 && n <= 114 ? n : null;
  }
  return SURAH_NAME_INDEX.get(normalizeArabic(trimmed)) ?? null;
}
async function mp3QuranGet(endpoint, params = {}) {
  const response = await http.get(`${MP3QURAN_API}/${endpoint}`, { params, timeout: 20000 });
  if (!response.data) throw new Error("استجابة MP3Quran فارغة");
  return response.data;
}
function paddedSurah(number) { return String(number).padStart(3, "0"); }
function parseAudioRequest(args) {
  const values = [...args];
  const mode = String(values.shift() || "").toLowerCase();
  if (!["audio", "mp3", "صوت", "تلاوة"].includes(mode)) return null;
  const readID = /^\d+$/.test(values.at(-1) || "") && values.length >= 3 ? Number(values.pop()) : 1;
  const ayahRange = values.pop() || "1";
  const match = String(ayahRange).match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return { error: "استخدم: quran audio <السورة> <الآية أو النطاق> [رقم القارئ]" };
  return { surahRaw: values.join(" "), start: Number(match[1]), end: Number(match[2] || match[1]), readID };
}
async function listReciters(api, event, query = "") {
  const data = await mp3QuranGet("reciters", { language: "ar" });
  const reciters = Array.isArray(data.reciters) ? data.reciters : [];
  const normalized = normalizeArabic(query);
  const filtered = normalized ? reciters.filter((r) => normalizeArabic(`${r.name} ${r.id}`).includes(normalized)) : reciters;
  if (!filtered.length) return api.sendMessage("غير موجود.", event.threadID, null, event.messageID);
  const lines = filtered.slice(0, 40).map((r) => {
    const reads = (r.moshaf || []).slice(0, 3).map((m) => `${m.id}: ${m.name}`).join(" | ");
    return `${r.id} — ${r.name}${reads ? ` — ${reads}` : ""}`;
  });
  return global.safeSend(api, lines.join("\n"), event.threadID, null, event.messageID);
}
async function sendAudioClip(api, event, request) {
  const surah = resolveSurahNumber(request.surahRaw);
  if (!surah || request.start < 1 || request.end < request.start) throw new Error("بيانات السورة أو الآيات غير صحيحة");
  const readsData = await mp3QuranGet("ayat_timing/reads");
  const read = (Array.isArray(readsData) ? readsData : []).find((item) => Number(item.id) === request.readID);
  if (!read?.folder_url) throw new Error("القارئ غير موجود أو لا يملك توقيت الآيات");
  const timingData = await mp3QuranGet("ayat_timing", { surah, read: request.readID });
  const timing = Array.isArray(timingData) ? timingData : [];
  const first = timing[request.start - 1];
  const last = timing[request.end - 1];
  if (!first || !last) throw new Error("الآية المطلوبة غير متاحة لهذا القارئ");
  const sourceURL = `${String(read.folder_url).replace(/\/$/, "")}/${paddedSurah(surah)}.mp3`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "quran-audio-"));
  const source = path.join(dir, "source.mp3");
  const output = path.join(dir, "clip.mp3");
  try {
    const response = await http.get(sourceURL, { responseType: "stream", timeout: 120000 });
    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(source);
      response.data.pipe(stream);
      response.data.on("error", reject);
      stream.on("error", reject);
      stream.on("finish", resolve);
    });
    const startSeconds = Number(first.start_time || 0) / 1000;
    const durationSeconds = Math.max(0.1, (Number(last.end_time) - Number(first.start_time || 0)) / 1000);
    await execFileAsync("ffmpeg", ["-y", "-ss", String(startSeconds), "-i", source, "-t", String(durationSeconds), "-vn", "-acodec", "copy", output], { timeout: 120000 });
    await directSend(api, event.threadID, { attachment: fs.createReadStream(output) }, event.messageID);
  } finally {
    await fs.remove(dir).catch(() => {});
  }
}

const MAX_MESSAGE_LENGTH = 10000;
/**
 * يقسّم مصفوفة من "كتل الآيات" النصية إلى رسائل، كل رسالة لا تتجاوز
 * MAX_MESSAGE_LENGTH حرفاً، دون تقسيم أي كتلة آية واحدة في منتصفها.
 */
function splitIntoMessages(header, blocks) {
  const messages = [];
  let current = header;
  for (const block of blocks) {
    if (current.length + block.length + 1 > MAX_MESSAGE_LENGTH) {
      messages.push(current.trimEnd());
      current = "";
    }
    current += block;
  }
  if (current.trim()) messages.push(current.trimEnd());
  return messages;
}
export default {
  config: {
    name: "quran",
    aliases: ["قران"],
    version: "3.0.0",
    author: "Shadow Garden",
    countDown: 5,
    role: 0,
    nonPrefix: true,
    category: "أدوات عامة",
    description: "جلب آيات قرآنية مع تفسيرها الميسر باستخدام اسم السورة",
    usage: [
      "{pn}قران <اسم السورة> <رقم الآية> — مثال: {pn}قران البقرة 255",
      "{pn}قران <اسم السورة> <من-إلى> — مثال: {pn}قران الكهف 1-14",
      "{pn}قران <رقم السورة> <رقم/نطاق الآية>",
      "{pn}قران قراء [بحث] — قائمة القراء من MP3Quran",
      "{pn}قران audio <السورة> <الآية أو النطاق> [رقم القارئ] — مقطع صوتي",
    ],
  },
  onStart: async function ({ api, event, args, message }) {
    const { threadID, messageID } = event;
    const input = args.join(" ").trim();
    if (String(args[0] || "").toLowerCase() === "قراء") {
      try { return await listReciters(api, event, args.slice(1).join(" ")); }
      catch (_) { return message.reply("غير موجود."); }
    }
    const audioRequest = parseAudioRequest(args);
    if (audioRequest) {
      if (audioRequest.error) return message.reply(audioRequest.error);
      try { return await sendAudioClip(api, event, audioRequest); }
      catch (error) { return message.reply(error.message || "تعذر إرسال المقطع الصوتي."); }
    }
    const usageText =
      "📖 **أمر القرآن والتفسير**\n\n" +
      "🔍 الاستخدام:\n" +
      "  quran <اسم السورة> <رقم الآية>\n" +
      "  quran <اسم السورة> <من-إلى>\n\n" +
      "💡 أمثلة:\n" +
      "  quran البقرة 255 (آية الكرسي)\n" +
      "  quran الفاتحة 1\n" +
      "  quran الكهف 1-14\n" +
      "  quran الناس 1-6\n\n" +
      "📊 عدد السور: 114 (يمكن كتابة الاسم بأو بدون \"ال\" التعريف)";
    if (!input) {
      return message.reply(usageText);
    }
    const parts = input.split(/\s+/);
    const lastToken = parts[parts.length - 1];
    const rangeMatch = lastToken.match(/^(\d+)(?:-(\d+))?$/);
    if (!rangeMatch || parts.length < 2) {
      return message.reply(
        "⚠️ **الصيغة خاطئة!**\n\n" +
        "📝 الاستخدام الصحيح:\n" +
        "  quran <اسم السورة> <رقم الآية أو من-إلى>\n\n" +
        "💡 أمثلة:\n" +
        "  quran البقرة 255\n" +
        "  quran الكهف 1-14"
      );
    }
    const surahRaw = parts.slice(0, -1).join(" ");
    const surahNum = resolveSurahNumber(surahRaw);
    if (!surahNum) {
      return message.reply(
        `❌ لم أتعرف على اسم السورة "${surahRaw}".\n` +
        "💡 تأكد من كتابة الاسم بشكل صحيح (مثال: الكهف، البقرة، يس)، أو استخدم رقم السورة (1-114)."
      );
    }
    let startAyah = parseInt(rangeMatch[1], 10);
    let endAyah = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : startAyah;
    if (startAyah < 1) {
      return message.reply("❌ رقم الآية يجب أن يكون أكبر من 0");
    }
    if (endAyah < startAyah) {
      return message.reply("❌ نهاية النطاق يجب أن تكون بعد بدايته (مثال: 1-14 وليس 14-1)");
    }
    try {
      const apiUrl = `https://api.alquran.cloud/v1/surah/${surahNum}/editions/quran-uthmani,ar.muyassar`;
      console.log(`[QURAN] 📖 السورة ${surahNum} - الآيات ${startAyah}-${endAyah}`);
      const response = await http.get(apiUrl, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      if (!response.data || response.data.code !== 200 || !Array.isArray(response.data.data) || response.data.data.length < 2) {
        throw new Error("استجابة غير صالحة من الخادم");
      }
      const [ayahEdition, tafsirEdition] = response.data.data;
      const ayahs = ayahEdition?.ayahs;
      const tafsirAyahs = tafsirEdition?.ayahs;
      if (!Array.isArray(ayahs) || !Array.isArray(tafsirAyahs)) {
        throw new Error("بيانات غير مكتملة من الخادم");
      }
      const totalAyahs = ayahs.length;
      if (startAyah > totalAyahs) {
        throw new Error(`سورة ${ayahEdition.name} تحتوي ${totalAyahs} آية فقط`);
      }
      endAyah = Math.min(endAyah, totalAyahs);
      const surahName = ayahEdition.name || "غير معروف";
      const surahEnglishName = ayahEdition.englishName || "";
      const revelationType = ayahEdition.revelationType === "Meccan" ? "مكية 🕋" : "مدنية 🕌";
      const rangeLabel = startAyah === endAyah ? `الآية ${startAyah}` : `الآيات ${startAyah}-${endAyah}`;
      const header =
        `✨ **﴿ ${surahName} - ${rangeLabel} ﴾** \n` +
        `━─━─━─「◽」─━─━─━\n` +
        `🕌 السورة: ${surahName} (${surahEnglishName}) | ${revelationType}\n` +
        `━─━─━─「◽」─━─━─━\n\n`;
      const blocks = [];
      for (let n = startAyah; n <= endAyah; n++) {
        const ayahText = ayahs[n - 1]?.text || "";
        const tafsirText = tafsirAyahs[n - 1]?.text || "تعذر جلب التفسير الميسر لهذه الآية.";
        blocks.push(
          `۝ **الآية ${n}:**\n` +
          `« ${ayahText} »\n` +
          `📖 التفسير: ${tafsirText}\n\n`
        );
      }
      const messages = splitIntoMessages(header, blocks);
      const multiPart = messages.length > 1;
      for (let i = 0; i < messages.length; i++) {
        const partLabel = multiPart ? `\n\n(الجزء ${i + 1}/${messages.length})` : "";
        await global.safeSend(api, messages[i] + partLabel, threadID, null, messageID);
        if (i < messages.length - 1) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
      console.log(`[QURAN] ✅ تم إرسال: ${surahName} - ${rangeLabel} (${messages.length} رسالة)`);
    } catch (error) {
      console.error(`[QURAN] ❌ خطأ:`, {
        message: error.message,
        code: error.code,
        status: error.response?.status,
      });
      let errorMsg = "حدث خطأ أثناء جلب الآيات";
      if (error.response?.status === 404) {
        errorMsg = `❌ لم يتم العثور على السورة أو الآيات المطلوبة.`;
      } else if (error.code === "ECONNABORTED") {
        errorMsg = "⏱️ انتهت مهلة الاتصال بالخادم";
      } else if (error.code === "ENOTFOUND") {
        errorMsg = "🌐 لا يوجد اتصال بالإنترنت";
      } else if (error.message) {
        errorMsg = `❌ ${error.message.substring(0, 150)}`;
      }
      await message.reply(errorMsg);
    }
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-fun-quran',
  meta: { category: 'command-fun', path: 'src/commands/fun/quran.js' },
  setup(_ctx) {
    // see module exports
  },
};
