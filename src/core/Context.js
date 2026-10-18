"use strict";
function buildMessageAPI(api, threadID, messageID) {
  return {
    reply: (t, cb) => new Promise((resolve, reject) => {
      global.safeSend(api, t, threadID, (err, info) => {
        if (cb) cb(err, info);
        if (err) reject(err);
        else resolve(info || {});
      }, messageID);
    }),
    unsend: (msgID, tid) => {
      try { api.unsendMessage(msgID, tid || threadID, () => {}); } catch (_) {}
    },
    registerReply: (id, d, cb, senderID) => {
      global.Kagenou.replies[id] = {
        callback: cb,
        author: senderID,
        timestamp: Date.now(),
        ...d,
      };
    },
  };
}
function getReplyTargetID(event) {
  return event?.messageReply?.messageID || event?.messageID;
}
function buildBanAwareStore({ getMap, banSet }) {
  return {
    getData: async (id) => {
      const key = String(id);
      const map = getMap();
      if (map?.has?.(key)) return map.get(key);
      return banSet === "_bannedGroups" ? { banned: global._bannedGroups?.has(key) ?? false } : {};
    },
    setData: async (id, data) => {
      const key = String(id);
      const map = getMap();
      if (map) {
        const merged = { ...(map.get(key) ?? {}), ...data };
        map.set(key, banSet === "_bannedGroups" ? merged : { ...merged, _dirty: true });
      }
      if ("banned" in data) {
        const set = global[banSet];
        if (data.banned) set?.add(key); else set?.delete(key);
      }
    },
  };
}
const buildUsersInterface   = () => buildBanAwareStore({ getMap: () => global.usersData,   banSet: "_bannedUsers"  });
const buildThreadsInterface = () => buildBanAwareStore({ getMap: () => global.threadsData, banSet: "_bannedGroups" });
function buildCommandContext({ api, event, args = [], role = 0, prefix = "", isGroupAdmin = false }) {
  const { threadID } = event;
  const commandMessageID = event.messageID;
  const messageID = getReplyTargetID(event);
  const commandEvent = messageID !== commandMessageID
    ? { ...event, commandMessageID, messageID }
    : event;
  const isGroup = !!commandEvent.isGroup;
  return {
    api,
    event: commandEvent,
    args,
    role,
    isGroup,
    isDM: !isGroup,
    isGroupAdmin,
    message: buildMessageAPI(api, threadID, messageID),
    prefix,
    usersData:  global.usersData,
    globalData: global.globalData,
    db:         global.db,
    Users:      buildUsersInterface(),
    Threads:    buildThreadsInterface(),
  };
}
export { buildMessageAPI, buildCommandContext, getReplyTargetID };
