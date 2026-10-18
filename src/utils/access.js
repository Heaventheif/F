function buildRoleSets() {
  global._rolesets = {
    dev: new Set((global.config.developers || []).map(String)),
  };
}
function getUserRole(uid, botIndex) {
  uid = String(uid);
  const r = global._rolesets || { dev: new Set() };
  if (r.dev.has(uid)) return 2;
  return 0;
}
function setCooldown(u, c, t) {
  global.userCooldowns.set(`${u}:${c}`, Date.now() + t * 1000);
}
function checkCooldown(u, c) {
  const key = `${u}:${c}`;
  const exp = global.userCooldowns.get(key);
  if (!exp || Date.now() >= exp) {
    global.userCooldowns.delete(key);
    return null;
  }
  return `⏳ انتظر ${Math.ceil((exp - Date.now()) / 1000)} ث`;
}
global._bannedGroups = new Set();
global._bannedUsers = new Set();
function buildBanSets() {
  global._bannedGroups = new Set((global.config.bannedGroups || []).map(String));
  global._bannedUsers = new Set((global.config.bannedUsers || []).map(String));
}
function isGroupUnbanRequest(event) {
  if (!event?.isGroup || !String(event.body ?? "").trim()) return false;
  const words = String(event.body).trim().split(/\s+/).map(v => v.toLowerCase());
  words[0] = words[0].replace(/^[.!#/]+/, "");
  const isUnban = (words[0] === "ban" && ["ungroup", "unblock-group", "unban-group"].includes(words[1])) ||
    (["المجموعة", "جروب"].includes(words[0]) && ["unban", "unblock", "رفع-الحظر", "رفعالحظر"].includes(words[1]));
  if (!isUnban) return false;
  const role = getUserRole(event.senderID, event.api?._botIndex ?? null);
  return role >= 2;
}
function checkAuth(senderID, command, botIndex = null, isGroupAdmin = false) {
  const role    = getUserRole(senderID, botIndex);
  const reqRole = command.config?.role ?? 0;
  const effectiveRole = (isGroupAdmin && role < 1) ? 1 : role;
  return effectiveRole < reqRole;
}
function checkAndSetCooldown(senderID, commandName, command) {
  const cdMsg = checkCooldown(senderID, commandName);
  if (cdMsg) return cdMsg;
  setCooldown(senderID, commandName, command.config?.countDown ?? 3);
  return null;
}
global.getUserRole = getUserRole;
export { buildRoleSets, getUserRole, buildBanSets, isGroupUnbanRequest, checkAuth, checkAndSetCooldown, checkCooldown, setCooldown };
