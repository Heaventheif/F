"use strict";
global._bannedGroups = new Set();
global._bannedUsers = new Set();
function buildBanSets() {
  global._bannedGroups = new Set((global.config.bannedGroups || []).map(String));
  global._bannedUsers = new Set((global.config.bannedUsers || []).map(String));
}
function isBanned(threadID, senderID) {
  if (threadID !== undefined && global._bannedGroups.has(String(threadID))) return true;
  if (senderID !== undefined && global._bannedUsers.has(String(senderID))) return true;
  return false;
}
function isGroupUnbanRequest(event) {
  if (!event?.isGroup || !String(event.body ?? "").trim()) return false;
  const words = String(event.body).trim().split(/\s+/).map(v => v.toLowerCase());
  words[0] = words[0].replace(/^[.!#/]+/, "");
  const groupWords = new Set(["group", "المجموعة", "جروب"]);
  const unbanWords = new Set(["unban", "unblock", "removeban", "رفع-الحظر", "رفعالحظر"]);
  if (!groupWords.has(words[0]) || !unbanWords.has(words[1])) return false;
  const role = global.getUserRole?.(event.senderID, event.api?._botIndex ?? null) ?? 0;
  return role >= 2;
}
global.isBanned = isBanned;
export { buildBanSets, isBanned, isGroupUnbanRequest };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-utils-ban-list',
  meta: { category: 'utils', path: 'src/utils/banList.js' },
  setup(_ctx) {
    // provides: buildBanSets, isBanned
  },
};
