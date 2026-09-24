"use strict";

// Log-Normal distribution — محاكاة سرعات الكتابة البشرية
function nextLogNormal(median, sigma) {
  // Box-Muller transform
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random() || 1e-10;
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return median * Math.exp(sigma * z);
}
function getTypingDuration(text) {
  if (typeof text !== "string") text = (text && typeof text.body === "string") ? text.body : "";
  if (!text) return 0;
  // وسيط 350ms مع انحراف 0.35 — يُعطي نطاقاً واقعياً بين ~150ms و~700ms
  return Math.min(nextLogNormal(350, 0.35), 700);
}

// نسبة إرسال مؤشر الكتابة: ~78% من الرسائل فقط (لا 100%)
// الباقي يُرسَل بدون مؤشر لمحاكاة البشر الذين لا يكتبون دائماً ببطء
const TYPING_INDICATOR_PROBABILITY = 0.78;

export default function enhanceBot() {
  // [FIX P1] idempotent: لا نُغلّف أكثر من مرة بغض النظر عن عدد الحسابات
  if (global.safeSend.__humanized) return;

  const baseSend = global.safeSend;
  const enhancedSend = async function enhancedSend(apiInstance, body, threadID, callback, messageID) {
    if (!body) return baseSend(apiInstance, body, threadID, callback, messageID);
    const textBody         = typeof body === "string" ? body : (typeof body?.body === "string" ? body.body : "");
    const isAttachmentOnly = typeof body === "object" && !!body?.attachment && !textBody;
    if (isAttachmentOnly) return baseSend(apiInstance, body, threadID, callback, messageID);

    const typingMs = getTypingDuration(textBody);
    // [FIX P1] نستخدم apiInstance (الحساب الفعلي للرسالة) بدل المرجع المغلق
    const shouldSendIndicator =
      typingMs > 0 &&
      Math.random() < TYPING_INDICATOR_PROBABILITY &&
      typeof apiInstance?.sendTypingIndicator === "function";

    if (shouldSendIndicator) {
      try {
        apiInstance.sendTypingIndicator(threadID, true, { duration: typingMs });
      } catch (err) {
        console.warn("[ENHANCER] sendTypingIndicator فشل:", err?.message);
      }
      // تأخير صغير عشوائي قبل الإرسال (لا يُساوي دائماً 50ms)
      await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 60));
    }
    return baseSend(apiInstance, body, threadID, callback, messageID);
  };

  enhancedSend.__humanized = true;
  global.safeSend = enhancedSend;
  console.log("[✅ ENHANCER] محاكاة الكتابة نشطة (إيقاع بشري غير متوقع)");
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-utils-bot-enhancer',
  meta: { category: 'utils', path: 'src/utils/bot-enhancer.js' },
  setup(_ctx) {
    // provides: enhanceBot
  },
};
