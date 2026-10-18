"use strict";
import { handleMessage, handleEvent, handleReaction, invalidateThreadInfoCache } from "../core/Router.js";
import { isGroupUnbanRequest } from "../utils/access.js";
const configuredConcurrency = Number.parseInt(process.env.MAX_CONCURRENT_COMMANDS || "5", 10);
const MAX_CONCURRENT = Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
  ? Math.min(configuredConcurrency, 50) : 5;
let _activeSlots = 0;
const _pendingQueue = [];
const MAX_QUEUE      = Number.parseInt(process.env.MAX_QUEUE || "200", 10) || 200;
const JOB_TIMEOUT_MS = (Number.parseInt(process.env.JOB_TIMEOUT_MIN || "5", 10) || 5) * 60_000;
function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`job timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(t));
}
function _enqueue(fn) {
  if (_pendingQueue.length >= MAX_QUEUE) {
    console.warn(`[QUEUE] ممتلئ (${MAX_QUEUE}) — تم إسقاط حدث`);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    _pendingQueue.push({ fn, resolve, reject });
    _drainQueue();
  });
}
function _drainQueue() {
  while (_activeSlots < MAX_CONCURRENT && _pendingQueue.length > 0) {
    const { fn, resolve, reject } = _pendingQueue.shift();
    _activeSlots++;
    withTimeout(Promise.resolve().then(fn), JOB_TIMEOUT_MS)
      .then(resolve, reject)
      .finally(() => { _activeSlots--; _drainQueue(); });
  }
}
export function dispatchMqttEvent(api, event, label, acceptedThreads) {
  const threadBanned = global._bannedGroups?.has(String(event.threadID));
  const senderBanned = global._bannedUsers?.has(String(event.senderID ?? event.userID));
  if (senderBanned || (threadBanned && !isGroupUnbanRequest({ ...event, api }))) return;
  if (!event.isGroup) return;
  if ((event.logMessageType === "change_thread_admins" || event.logMessageType === "log:thread-admins") && event.threadID) {
    invalidateThreadInfoCache(event.threadID);
  }
  if (event.threadID && (
    (event.logMessageType === "remove_from_group" &&
      event.participantIDs?.some(id => String(id) === String(api.getCurrentUserID?.()))) ||
    (event.logMessageType === "log:unsubscribe" &&
      String(event.logMessageData?.leftParticipantFbId) === String(api.getCurrentUserID?.()))
  )) {
    invalidateThreadInfoCache(event.threadID);
    console.log(`[CACHE] 🗑️ Bot أُخرج من المجموعة ${event.threadID} — cache مُبطَل.`);
  }
  if (["message", "message_reply", "log", "event"].includes(event.type)) {
    _enqueue(async () => {
      try {
        await handleEvent(api, event);
      } catch (e) {
        console.error(`[EVENT ERR:${label}]`, e?.message ?? e);
      }
      try {
        await handleMessage(api, event);
      } catch (e) {
        console.error(`[MSG ERR:${label}]`, e?.message ?? e);
      }
    }).catch(e => console.error(`[QUEUE ERR:${label}]`, e?.message ?? e));
  } else if (event.type === "message_reaction") {
    try {
      handleReaction(api, event);
    } catch (e) {
      console.error(`[REACTION ERR:${label}]`, e?.message ?? e);
    }
  }
}
