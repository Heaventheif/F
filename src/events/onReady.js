"use strict";
import { cache, cleanupOrphanTempFiles } from "../utils/system.js";
export function startCleanupInterval() {
  setInterval(() => {
    const now     = Date.now();
    let   cleaned = 0;
    for (const [id, data] of Object.entries(global.Kagenou.replies)) {
      if (now - (data.timestamp || 0) > 10 * 60 * 1000) {
        delete global.Kagenou.replies[id]; cleaned++;
      }
    }
    for (const [key, exp] of global.userCooldowns.entries()) {
      if (now >= exp) { global.userCooldowns.delete(key); cleaned++; }
    }
    for (const [msgID, ts] of global._reactionTimestamps.entries()) {
      if (now - ts > 10 * 60 * 1000) {
        delete global.client.reactionListener[msgID];
        global._reactionTimestamps.delete(msgID);
        cleaned++;
      }
    }
    cleanupOrphanTempFiles();
    try { cleaned += cache.sweep(); } catch (e) { console.warn("[CLEANUP] cache.sweep:", e?.message ?? e); }
    try { cleaned += global.cleanupIdleThreadGates(); } catch (e) { console.warn("[CLEANUP] gates:", e?.message ?? e); }
    const mem = process.memoryUsage();
    const pm  = global.perfManager?.getMetrics();
    console.log(
      `[CLEANUP] 🧹 ${cleaned} مدخلة | RSS: ${Math.round(mem.rss/1024/1024)}MB` +
      ` | Heap: ${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB` +
      (pm ? ` | Cache: ${pm.cacheSize} (hit ${(pm.cacheHitRate * 100).toFixed(0)}%) | avg: ${pm.avgResponseTimeMs}ms` : "") +
      ` | Bots: ${global.botApis.length}`
    );
  }, 10 * 60 * 1000).unref();
}
