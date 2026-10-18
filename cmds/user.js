"use strict";
const _config = {
  name: "user",
  version: "2.2.0",
  author: "dev",
  countDown: 5,
  role: 1,
  description: {
    ar: "إدارة المستخدمين: معرف، اسم، طرد، إضافة",
  },
  category: "admin",
  guide: {
    ar:
      "{pn} id @شخص          — عرض UID الشخص\n" +
      "{pn} name @شخص <اسم>  — تغيير اللقب\n" +
      "{pn} kick @شخص        — طرد من المجموعة\n" +
      "{pn} add <UID>         — إضافة مستخدم للمجموعة",
  },
};
export default {
  config: _config,
  run: async function ({ api, event, args, role, Users, Threads, prefix }) {
    const { threadID, messageID } = event;
    const sub = (args[0] || "").toLowerCase();
    switch (sub) {
      case "id":
        return handleID(api, event, args.slice(1));
      case "name":
        return handleName(api, event, args.slice(1));
      case "kick":
        return handleKick(api, event, args.slice(1));
      case "add":
        return handleAdd(api, event, args.slice(1));
      default:
        return api.sendMessage(
          `❓ الاستخدام:\n${_config.guide.ar.replace(/{pn}/g, prefix + "user")}`,
          threadID,
          null,
          messageID
        );
    }
  },
};
function targetIDs(event, args = []) {
  const ids = Object.keys(event?.mentions || {});
  const replyID = event?.messageReply?.senderID || event?.messageReply?.author;
  if (replyID && !ids.includes(String(replyID))) ids.push(String(replyID));
  for (const value of args) {
    if (/^\d{6,}$/.test(String(value)) && !ids.includes(String(value))) ids.push(String(value));
  }
  return ids;
}
function mentionName(event, uid) {
  return String(event?.mentions?.[uid] || '').replace('@', '').trim();
}
async function resolveNames(api, event, uids) {
  const names = new Map();
  const missing = [];
  for (const uid of uids) {
    const m = mentionName(event, uid);
    if (m) names.set(uid, m); else missing.push(uid);
  }
  if (missing.length) {
    try {
      const info = await api.getUserInfo(missing);
      for (const uid of missing) {
        const i = info?.[uid] || {};
        names.set(uid, String(i.name || i.fullName || i.displayName || i.firstName || uid));
      }
    } catch (e) {
      console.warn("[user] getUserInfo failed:", e?.message ?? e);
      for (const uid of missing) names.set(uid, uid);
    }
  }
  return names;
}
const MAX_TARGETS = 10;
const skippedNote = (r) => /skipped/.test(r.error?.message ?? "") ? " (أُوقف: حد المعدل)" : "";
async function handleID(api, event, args = []) {
  const { threadID, messageID, senderID } = event;
  const targets = targetIDs(event, args);
  return api.sendMessage(targets.length ? targets.join('\n') : String(senderID ?? ''), threadID, null, messageID);
}
async function handleName(api, event, args) {
  const { threadID, messageID } = event;
  const targets = targetIDs(event, args);
  if (!targets.length)
    return api.sendMessage("⚠️ قم بمنشن الشخص المراد تغيير لقبه.", threadID, null, messageID);
  const newName = args
    .filter((a) => !a.startsWith("@") && !/^\d+$/.test(a))
    .join(" ")
    .trim();
  if (!newName)
    return api.sendMessage(
      "⚠️ أدخل الاسم الجديد بعد المنشن.\nمثال: user name @شخص الاسم الجديد",
      threadID,
      null,
      messageID
    );
  const list  = targets.slice(0, MAX_TARGETS);
  const names = await resolveNames(api, event, list);
  const res   = await global.runThrottled(list, (uid) => api.changeNickname(newName, threadID, uid));
  const lines = res.map((r) => r.ok
    ? `✅ تم تغيير لقب ${names.get(r.item)} — ${r.item} إلى "${newName}"`
    : `❌ فشل تغيير لقب ${r.item}${skippedNote(r)}`);
  if (targets.length > MAX_TARGETS) lines.push(`ℹ️ نُفّذ أول ${MAX_TARGETS} فقط من ${targets.length}.`);
  api.sendMessage(lines.join("\n"), threadID, null, messageID);
}
async function handleKick(api, event, args = []) {
  const { threadID, messageID, senderID } = event;
  const targets = targetIDs(event, args);
  if (!targets.length)
    return api.sendMessage("⚠️ قم بمنشن الشخص المراد طرده.", threadID, null, messageID);
  if (targets.includes(senderID))
    return api.sendMessage("⚠️ لا يمكنك طرد نفسك.", threadID, null, messageID);
  const list  = targets.slice(0, MAX_TARGETS);
  const names = await resolveNames(api, event, list);
  const res   = await global.runThrottled(list, (uid) => api.removeUserFromGroup(uid, threadID));
  const lines = res.map((r) => r.ok
    ? `✅ تم طرد ${names.get(r.item)} — ${r.item}`
    : `❌ فشل طرد ${r.item} — تحقق من صلاحيات البوت${skippedNote(r)}`);
  if (targets.length > MAX_TARGETS) lines.push(`ℹ️ نُفّذ أول ${MAX_TARGETS} فقط من ${targets.length}.`);
  api.sendMessage(lines.join("\n"), threadID, null, messageID);
}
async function handleAdd(api, event, args) {
  const { threadID, messageID } = event;
  const targets = targetIDs(event, args);
  if (!targets.length)
    return api.sendMessage(
      "⚠️ قم بمنشن الشخص أو أدخل UID الشخص المراد إضافته.\nمثال: user add 100012345678",
      threadID,
      null,
      messageID
    );
  const list  = targets.slice(0, MAX_TARGETS);
  const names = await resolveNames(api, event, list);
  const res   = await global.runThrottled(list, (uid) => api.addUserToGroup(uid, threadID));
  const lines = res.map((r) => {
    if (r.ok) return `✅ تمت إضافة ${names.get(r.item)} — ${r.item}`;
    const err = r.error;
    const reason =
      err?.error === 1545145 ? "الشخص موجود بالفعل" :
      err?.error === 200     ? "لا توجد صلاحية كافية" :
      /skipped/.test(err?.message ?? "") ? "أُوقف: حد المعدل" :
      "خطأ غير معروف";
    return `❌ فشل إضافة ${r.item}: ${reason}`;
  });
  if (targets.length > MAX_TARGETS) lines.push(`ℹ️ نُفّذ أول ${MAX_TARGETS} فقط من ${targets.length}.`);
  api.sendMessage(lines.join("\n"), threadID, null, messageID);
}
