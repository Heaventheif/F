import http from '../utils/fetchHttp.js';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { getHfBaseOrNull, getInternalToken  } from '../utils/hfClient.js';
export default {
  config: {
    name: "sub",
    aliases: ["كابشن"],
    role: 0, 
    countDown: 60, 
    category: "وسائط وتحميل",
    description: "إضافة ترجمة (ثابتة أو زمنية) على فيديو عبر الرد عليه، مع تحكم بموضع النص عمودياً",
    usage: [
      "رد على فيديو + {pn}ترجمة2 <النص> — ترجمة ثابتة طوال الفيديو (الموضع الافتراضي 4)",
      "رد على فيديو + {pn}ترجمة2 <رقم الموضع 1-5> <النص> — ترجمة ثابتة بموضع محدد",
      "رد على فيديو + {pn}ترجمة2 <رقم الموضع> 00:01 - 00:03 <النص> — سطر ترجمة زمني بموضع محدد",
      "يمكن تكرار السطر الأخير عدة مرات (سطر لكل ترجمة)، كل سطر بموضعه وتوقيته الخاص",
    ],
  },
  onStart: async ({ api, event, args }) => {
    const { threadID, messageID, type, messageReply, body } = event;
    if (type !== "message_reply" || !messageReply || !messageReply.attachments || messageReply.attachments.length === 0) {
      return api.sendMessage("❌ يرجى استخدام الأمر عبر الرد (Reply) على مقطع فيديو!", threadID, null, messageID);
    }
    const attachment = messageReply.attachments[0];
    if (attachment.type !== "video") {
      return api.sendMessage("❌ الرسالة التي رددت عليها لا تحتوي على فيديو مدعوم!", threadID, null, messageID);
    }
    const rawBody = body || "";
    const bodyMatch = rawBody.match(/^\S+\s([\s\S]*)$/);
    const subText = bodyMatch ? bodyMatch[1].trim() : "";
    if (!subText) {
      return api.sendMessage(
        "💡 يرجى كتابة نص الترجمة بعد الأمر.\n\n" +
        "🔹 ترجمة ثابتة (موضع افتراضي 4):\nsub النص هنا\n\n" +
        "🔹 ترجمة ثابتة بموضع محدد (1 إلى 5):\nsub 3 النص هنا\n\n" +
        "🔹 ترجمة زمنية بموضع محدد:\nsub\n2 00:01 - 00:03 أهلاً بكم\n5 00:04 - 00:07 في مجموعتنا\n\n" +
        "📍 مواضع العمود (Y): 1=أعلى الشاشة، 2، 3=المنتصف، 4 (افتراضي)، 5=أسفل الشاشة",
        threadID, null, messageID
      );
    }
    let cues;
    try {
      cues = parseSubtitleCues(subText);
    } catch (parseErr) {
      return api.sendMessage(`❌ خطأ في تحليل صيغة الترجمة: ${parseErr.message}`, threadID, null, messageID);
    }
    if (!cues.length) {
      return api.sendMessage("❌ لم أستطع فهم أي سطر ترجمة صالح من النص المُدخل.", threadID, null, messageID);
    }
    let statusMsgId = null;
    try {
      const sent = await new Promise((resolve, reject) =>
        api.sendMessage(
          "⏳ يتم تحميل الفيديو ومعالجته عبر Hugging Face Space، يرجى الانتظار...",
          threadID,
          (err, info) => (err ? reject(err) : resolve(info)),
          messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}
    const updateStatus = async (text) => {
      try {
        if (statusMsgId) await api.editMessage(text, statusMsgId);
        else await api.sendMessage(text, threadID, null, messageID);
      } catch (_) {}
    };
    const HF_SPACE_URL = getHfBaseOrNull();
    const INTERNAL_TOKEN = getInternalToken();
    if (!HF_SPACE_URL) {
      return updateStatus("❌ خطأ في الإعدادات: لم يتم ضبط رابط HF_SPACE_URL في متغيرات البيئة الخاصة بالبوت.");
    }
    const uniqueId = Date.now();
    const tempFilePath = path.join(os.tmpdir(), `subtitled_${uniqueId}.mp4`);
    try {
      const createResponse = await http.post(`${HF_SPACE_URL}/subtitler/create`, {
        video_url: attachment.url,
        cues,
      }, {
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": INTERNAL_TOKEN
        }
      });
      const { job_id } = createResponse.data;
      let jobStatus = null;
      let attempts = 0;
      const maxAttempts = 30; 
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
        const statusResponse = await http.get(`${HF_SPACE_URL}/subtitler/status/${job_id}`, {
          headers: { "X-Internal-Token": INTERNAL_TOKEN },
          responseType: 'json'
        });
        jobStatus = statusResponse.data;
        if (jobStatus.status === "error") {
          throw new Error(jobStatus.reason || "حدث خطأ غير معروف أثناء معالجة الميديا داخل الـ Space.");
        }
        if (jobStatus.status === "done") {
          break;
        }
      }
      if (!jobStatus || jobStatus.status !== "done") {
        throw new Error("تجاوزت عملية المعالجة الوقت المحدد المسموح به (Timeout).");
      }
      const downloadResponse = await http.get(`${HF_SPACE_URL}${jobStatus.download_url}`, {
        headers: { "X-Internal-Token": INTERNAL_TOKEN },
        responseType: 'stream'
      });
      const writer = fs.createWriteStream(tempFilePath);
      downloadResponse.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      if (statusMsgId) {
        try { await api.unsendMessage(statusMsgId, threadID); } catch (_) {}
      }
      await new Promise((resolve, reject) => {
        global.safeSend(
          api,
          {
            body: "✅ تم دمج الترجمة على الفيديو بنجاح!",
            attachment: fs.createReadStream(tempFilePath)
          },
          threadID,
          (err) => (err ? reject(err) : resolve()),
          messageID
        );
      });
    } catch (error) {
      console.error("Error in sub command:", error.message);
      console.error("[sub:process]", error.message);
      await updateStatus("❌ فشل معالجة الفيديو — تم إبلاغ المطوّر.");
    } finally {
      if (await fs.exists(tempFilePath)) {
        await fs.remove(tempFilePath);
      }
    }
  }
};
const DEFAULT_POSITION = 4; 
const VALID_POSITIONS = new Set([1, 2, 3, 4, 5]);
const TIME_RE = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
function timeToSeconds(t) {
  const parts = t.split(":").map(Number);
  if (parts.some(Number.isNaN)) throw new Error(`صيغة وقت غير صالحة: "${t}"`);
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  return seconds;
}
function parseSubtitleLine(line) {
  let rest = line.trim();
  if (!rest) return null;
  let position = null;
  let startSec = null;
  let endSec = null;
  const posMatch = rest.match(/^([1-5])\s+(.+)$/s);
  if (posMatch) {
    const candidate = parseInt(posMatch[1], 10);
    if (VALID_POSITIONS.has(candidate)) {
      position = candidate;
      rest = posMatch[2].trim();
    }
  }
  const timeMatch = rest.match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s*-\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*\|?\s*(.*)$/s);
  if (timeMatch) {
    const [, startRaw, endRaw, remaining] = timeMatch;
    if (TIME_RE.test(startRaw) && TIME_RE.test(endRaw)) {
      startSec = timeToSeconds(startRaw);
      endSec = timeToSeconds(endRaw);
      if (endSec <= startSec) {
        throw new Error(`وقت النهاية يجب أن يكون بعد وقت البداية: "${line.trim()}"`);
      }
      rest = remaining.trim();
    }
  }
  const text = rest.trim();
  if (!text) {
    throw new Error(`السطر لا يحتوي على نص ترجمة بعد الموضع/التوقيت: "${line.trim()}"`);
  }
  return {
    position: position ?? DEFAULT_POSITION, 
    start: startSec, 
    end: endSec,     
    text,
  };
}
function parseSubtitleCues(fullText) {
  const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
  const cues = [];
  for (const line of lines) {
    const cue = parseSubtitleLine(line);
    if (cue) cues.push(cue);
  }
  return cues;
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-media-sub',
  meta: { category: 'command-media', path: 'src/commands/media/sub.js' },
  setup(_ctx) {
    // see module exports
  },
};
