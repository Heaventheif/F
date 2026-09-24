"use strict";
// directSend delegates to global.safeSend (gatedSend) to avoid a duplicate
// throttle layer. safeSend already handles per-thread gating and stealth mode.
async function directSend(api, threadID, messageBody, replyToID = undefined) {
  try {
    await global.safeSend(api, messageBody, threadID, undefined, replyToID);
    return true;
  } catch (e) {
    console.error("[DIRECT_SEND] خطأ:", e?.message?.substring(0, 120));
    return false;
  }
}
const PART_RETRY_ATTEMPTS = 3;
const PART_RETRY_DELAY_MS = 1500;
async function directSendParts(api, threadID, title, streams, replyToID = undefined) {
  const total = streams.length;
  let sent = 0;
  const failedParts = [];
  for (let i = 0; i < total; i++) {
    const stream = streams[i]?.stream ?? streams[i];
    let ok = false;
    for (let attempt = 1; attempt <= PART_RETRY_ATTEMPTS && !ok; attempt++) {
      const attemptStream = (attempt > 1 && typeof streams[i]?.reopen === "function")
        ? streams[i].reopen()
        : stream;
      ok = await directSend(api, threadID, { attachment: attemptStream }, replyToID);
      if (!ok && attempt < PART_RETRY_ATTEMPTS) {
        console.warn(`[DIRECT_SEND] إعادة محاولة الجزء ${i + 1}/${total} (محاولة ${attempt + 1}/${PART_RETRY_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, PART_RETRY_DELAY_MS * attempt));
      }
    }
    if (ok) {
      sent++;
    } else {
      failedParts.push(i + 1);
      console.warn(`[DIRECT_SEND] فشل إرسال الجزء ${i + 1}/${total} نهائياً بعد ${PART_RETRY_ATTEMPTS} محاولات`);
    }
  }
  if (failedParts.length > 0) {
    const note = `⚠️ فشل إرسال ${failedParts.length} من ${total} جزء (الأجزاء: ${failedParts.join(", ")}) — ${title || ""}`.trim();
    await directSend(api, threadID, note, replyToID).catch(() => {});
  }
  return { sent, failedParts, total };
}
export { directSend, directSendParts };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-utils-direct-send',
  meta: { category: 'utils', path: 'src/utils/directSend.js' },
  setup(_ctx) {
    // provides: directSend, directSendParts
  },
};
