"use strict";
import fs from "fs-extra";
import path from "path";
import { pathToFileURL } from "url";
export const HANDLER_KEYS = ["onStart", "run", "execute", "main", "handle", "onMessage", "init", "call"];
const findHandlerKey = (obj) => HANDLER_KEYS.find((k) => typeof obj[k] === "function");
function resolveModule(raw, file) {
  const def = raw.default;
  const mod = def && (typeof def === "object" || typeof def === "function") ? def : raw;
  if (typeof mod === "function") {
    return { name: path.basename(file, ".js").toLowerCase(), mod: { run: mod }, onChat: null, onReply: null };
  }
  const handlerKey   = findHandlerKey(mod);
  const namedHandler = handlerKey ? null : findHandlerKey(raw);
  if (!handlerKey && !namedHandler && !mod.onChat && !raw.onChat) return null;
  const resolved = namedHandler ? { ...raw, ...mod } : mod;
  return {
    name:    String(resolved.config?.name || path.basename(file, ".js")).toLowerCase(),
    mod:     resolved,
    onChat:  resolved.onChat  || raw.onChat  || null,
    onReply: resolved.onReply || raw.onReply || null,
  };
}
function collectCommandFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".js"))
    .map((d) => path.join(dir, d.name));
}
let _lastGoodOverrides = {};
function loadOverrides(commandsDir) {
  const file = path.join(commandsDir, "..", "..", "cmd-overrides.json");
  if (!fs.existsSync(file)) return {};
  try {
    return (_lastGoodOverrides = JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (e) {
    console.error(`[CMDS] cmd-overrides.json غير صالح — تُستخدم آخر نسخة سليمة: ${e.message}`);
    return _lastGoodOverrides;
  }
}
export async function loadCommands(commandsDir) {
  const overrides  = loadOverrides(commandsDir);
  const filePaths  = collectCommandFiles(commandsDir);
  const fileErrors = [];
  const stamp      = Date.now();
  console.log(`[CMDS] 📦 بدء تحميل ${filePaths.length} ملف (متوازي)...`);
  const results = await Promise.allSettled(
    filePaths.map((p) => import(`${pathToFileURL(p).href}?update=${stamp}`))
  );
  const newCommands  = new Map();
  const newEventCmds = [];
  results.forEach((result, i) => {
    const file = path.basename(filePaths[i]);
    if (result.status === "rejected") {
      console.warn(`[CMDS]   ↳ ${file} ❌ ${result.reason?.message}`);
      fileErrors.push({ file, message: result.reason?.message });
      return;
    }
    try {
      const resolved = resolveModule(result.value, file);
      if (!resolved) { console.log(`[CMDS]   ↳ ${file} ⏭️`); return; }
      const { name, mod, onChat, onReply } = resolved;
      mod.config ||= {};
      const ov = overrides[name];
      if (ov) {
        if (typeof ov.enabled === "boolean") mod.config.enabled = ov.enabled;
        if (typeof ov.hidden  === "boolean") mod.config.hidden  = ov.hidden;
      }
      const register = (key, value, kind) => {
        const normalized = String(key).toLowerCase();
        const previous = newCommands.get(normalized);
        if (previous && previous !== value) {
          const message = `تعارض ${kind} "${normalized}" في ${file}`;
          console.warn(`[CMDS] ⚠️ ${message} — تم تجاهل الاسم المتعارض`);
          fileErrors.push({ file, message });
          return false;
        }
        newCommands.set(normalized, value);
        return true;
      };
      if (!register(name, mod, "اسم")) return;
      for (const a of mod.config.aliases || []) register(a, mod, "اختصار");
      if (onReply && !mod.onReply) mod.onReply = onReply;
      if (onChat) {
        if (!mod.onChat) mod.onChat = onChat;
        newEventCmds.push(mod);
      }
      console.log(`[CMDS]   ↳ ${file} ✅ (${name})`);
    } catch (err) {
      console.warn(`[CMDS]   ↳ ${file} ❌ ${err.message}`);
      fileErrors.push({ file, message: err.message });
    }
  });
  global.commands.clear();
  for (const [k, v] of newCommands) global.commands.set(k, v);
  global.eventCommands = newEventCmds;
  console.log(`[INFO] تم تحميل ${global.commands.size} أمر من أصل ${filePaths.length} ملف`);
  return fileErrors;
}
