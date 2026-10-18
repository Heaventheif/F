import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "node:url";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT = path.join(MODULE_DIR, "..", "..", "cache");
const AI_DIRS = ["ai_sessions_gptx"];
const SKIP_FILES = new Set(["Readme.me", "empty.txt", ".gitkeep"]);
function formatBytes(bytes) {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = value => String(value).padStart(2, "0");
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  return days ? `${days}ي ${clock}` : clock;
}
async function clearDirectory(dirPath) {
  let deleted = 0;
  let freed = 0;
  try {
    if (!await fs.pathExists(dirPath)) return { deleted, freed };
    for (const name of await fs.readdir(dirPath)) {
      if (SKIP_FILES.has(name)) continue;
      try {
        const filePath = path.join(dirPath, name);
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        await fs.remove(filePath);
        deleted++;
        freed += stat.size;
      } catch (error) {
        console.warn(`[UP] تعذر حذف ${name}:`, error?.message ?? error);
      }
    }
  } catch (error) {
    console.warn("[UP] تعذر قراءة مجلد الكاش:", error?.message ?? error);
  }
  return { deleted, freed };
}
async function remainingFiles(dirPath) {
  try {
    if (!await fs.pathExists(dirPath)) return { count: 0, size: 0 };
    let count = 0;
    let size = 0;
    for (const name of await fs.readdir(dirPath)) {
      if (SKIP_FILES.has(name)) continue;
      try {
        const stat = await fs.stat(path.join(dirPath, name));
        if (stat.isFile()) { count++; size += stat.size; }
      } catch (_) {}
    }
    return { count, size };
  } catch (_) {
    return { count: 0, size: 0 };
  }
}
export default {
  config: {
    name: "up",
    aliases: ["تحديث"],
    version: "4.0.0",
    author: "SunkenBot Developer",
    countDown: 10,
    role: 2,
    category: "إدارة وإشراف",
    description: "تنظيف كاش الذكاء الاصطناعي وعرض حالة النظام",
    usage: ["{pn}تحديث — تنظيف الكاش وعرض حالة النظام"],
    hidden: true,
  },
  onStart: async ({ message }) => {
    const startedAt = Date.now();
    let deleted = 0;
    let freed = 0;
    let remaining = 0;
    let remainingSize = 0;
    for (const dir of AI_DIRS) {
      const result = await clearDirectory(path.join(CACHE_ROOT, dir));
      deleted += result.deleted;
      freed += result.freed;
      const left = await remainingFiles(path.join(CACHE_ROOT, dir));
      remaining += left.count;
      remainingSize += left.size;
    }
    try {
      if (typeof global.gc === "function") global.gc();
    } catch (_) {}
    const memory = process.memoryUsage();
    const lines = [
      "✅ SunkenBot يعمل",
      `⏱️ Uptime: ${formatUptime(Math.floor(process.uptime()))}`,
      `📦 الأوامر: ${global.commands?.size ?? 0}`,
      `🧹 الكاش: حُذف ${deleted} ملف (${formatBytes(freed)})` ,
      `📁 المتبقي: ${remaining} ملف (${formatBytes(remainingSize)})`,
      `💾 الذاكرة: RSS ${formatBytes(memory.rss)} — Heap ${formatBytes(memory.heapUsed)}`,
      `⚡ الزمن: ${Date.now() - startedAt}ms`,
    ];
    await message.reply(lines.join("\n"));
  },
};
