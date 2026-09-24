/**
 * @file plugin-provider.js
 * @description مزوّد البلاجينات المركزي — مسارات مُصحَّحة لتطابق البنية الفعلية.
 *
 * @typedef {{
 *   name:        string,
 *   meta?:       { category?: string, path?: string },
 *   middlewares?: Function[],
 *   commands?:    Array<{name:string, handler:Function, options?:object}>,
 *   events?:      Record<string, Function>,
 *   setup?:      (ctx: object) => void | Promise<void>,
 * }} XxPlugin
 */

// ── BUG-02 FIX: مسارات LAZY_REGISTRY مُصحَّحة لتطابق src/cmds/ الفعلي ────────
/** @type {Array<[string, () => Promise<{$plugin: XxPlugin}>]>} */
const LAZY_REGISTRY = [
  // ── الأوامر (src/cmds/) ──────────────────────────────────────────────────
  ['general',    () => import('./src/cmds/help.js')],
  ['ai',         () => import('./src/cmds/gemini.js')],
  ['ai',         () => import('./src/cmds/gptx.js')],
  ['ai',         () => import('./src/cmds/groq.js')],
  ['ai',         () => import('./src/cmds/draw.js')],
  ['ai',         () => import('./src/cmds/stt.js')],
  ['ai',         () => import('./src/cmds/tr.js')],
  ['ai',         () => import('./src/cmds/tts.js')],
  ['fun',        () => import('./src/cmds/animal.js')],
  ['fun',        () => import('./src/cmds/chess.js')],
  ['fun',        () => import('./src/cmds/comic.js')],
  ['fun',        () => import('./src/cmds/manga.js')],
  ['fun',        () => import('./src/cmds/novel.js')],
  ['fun',        () => import('./src/cmds/quran.js')],
  ['fun',        () => import('./src/cmds/slap.js')],
  ['media',      () => import('./src/cmds/autodl.js')],
  ['media',      () => import('./src/cmds/canva.js')],
  ['media',      () => import('./src/cmds/pin.js')],
  ['media',      () => import('./src/cmds/random.js')],
  ['media',      () => import('./src/cmds/song.js')],
  ['media',      () => import('./src/cmds/sub.js')],
  ['media',      () => import('./src/cmds/up.js')],
  ['media',      () => import('./src/cmds/yt.js')],
  ['media',      () => import('./src/cmds/img.js')],
  ['user',       () => import('./src/cmds/user.js')],
  ['user',       () => import('./src/cmds/group.js')],
  ['user',       () => import('./src/cmds/unsend.js')],
  // ── النواة (src/core/) ───────────────────────────────────────────────────
  ['config',     () => import('./src/config/index.js')],
  ['core',       () => import('./src/core/Client.js')],
  ['core',       () => import('./src/core/Context.js')],
  ['core',       () => import('./src/core/Loader.js')],
  ['core',       () => import('./src/core/Router.js')],
  // ── الأحداث ──────────────────────────────────────────────────────────────
  ['events',     () => import('./src/events/onMessage.js')],
  ['events',     () => import('./src/events/onReady.js')],
  // ── الوسطاء ──────────────────────────────────────────────────────────────
  ['middleware', () => import('./src/middlewares/auth.js')],
  ['middleware', () => import('./src/middlewares/cooldown.js')],
  // ── السيرفر (المسار الصحيح) ───────────────────────────────────────────────
  ['server',     () => import('./src/webServer.js')],
  // ── الأدوات ──────────────────────────────────────────────────────────────
  ['utils',      () => import('./src/utils/banList.js')],
  ['utils',      () => import('./src/utils/bot-enhancer.js')],
  ['utils',      () => import('./src/utils/cache.js')],
  ['utils',      () => import('./src/utils/concurrentDownload.js')],
  ['utils',      () => import('./src/utils/directSend.js')],
  ['utils',      () => import('./src/utils/envCheck.js')],
  ['utils',      () => import('./src/utils/fetchHttp.js')],
  ['utils',      () => import('./src/utils/hfClient.js')],
  ['utils',      () => import('./src/utils/mediaSplitter.js')],
  ['utils',      () => import('./src/utils/mediaStream.js')],
  ['utils',      () => import('./src/utils/pinterestProviders.js')],
  ['utils',      () => import('./src/utils/reactionPicker.js')],
  ['utils',      () => import('./src/utils/roles.js')],
  ['utils',      () => import('./src/utils/safeSend.js')],
  ['utils',      () => import('./src/utils/sharedSession.js')],
  ['utils',      () => import('./src/utils/tempCleanup.js')],
  ['utils',      () => import('./src/utils/timing.js')],
  ['utils',      () => import('./src/utils/translator.js')],
  ['utils',      () => import('./src/utils/urlNormalizer.js')],
  ['utils',      () => import('./src/utils/validate.js')],
  ['utils',      () => import('./src/utils/ytEngine.js')],
  ['utils',      () => import('./src/utils/ytProviders.js')],
];

// ── كاش للوحدات المُحمَّلة ───────────────────────────────────────────────────
/** @type {Map<number, XxPlugin>} */
const _loaded = new Map();

async function _load(idx) {
  if (_loaded.has(idx)) return _loaded.get(idx);
  const [, loader] = LAZY_REGISTRY[idx];
  try {
    const mod = await loader();
    const plugin = mod.$plugin;
    _loaded.set(idx, plugin);
    return plugin;
  } catch (err) {
    console.warn(`[plugin-provider] ⚠️ فشل تحميل [${LAZY_REGISTRY[idx][0]}] index=${idx}:`, err.message);
    return null;
  }
}

async function _loadAll() {
  const results = await Promise.all(LAZY_REGISTRY.map((_, i) => _load(i)));
  return results.filter(Boolean);
}

export async function registerAll(pluginSystem, options = {}) {
  const { categories, names, exclude = [] } = options;

  let indices = LAZY_REGISTRY.map((_, i) => i);
  if (Array.isArray(categories) && categories.length)
    indices = indices.filter(i => categories.includes(LAZY_REGISTRY[i][0]));

  const plugins = (await Promise.all(indices.map(i => _load(i)))).filter(Boolean);

  let list = plugins;
  if (Array.isArray(names) && names.length)
    list = list.filter(p => names.includes(p?.name));
  if (exclude.length)
    list = list.filter(p => !exclude.includes(p?.name));

  for (const plugin of list)
    if (plugin && !pluginSystem.has(plugin.name)) await pluginSystem.register(plugin);
}

export async function registerByCategory(pluginSystem, category) {
  return registerAll(pluginSystem, { categories: [category] });
}

export async function getPlugin(name) {
  const all = await _loadAll();
  return all.find(p => p?.name === name);
}

export function listCategories() {
  return [...new Set(LAZY_REGISTRY.map(([cat]) => cat))].sort();
}

export default { registerAll, registerByCategory, getPlugin, listCategories };
