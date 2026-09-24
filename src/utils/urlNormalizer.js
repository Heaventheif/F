"use strict";
const REDIRECT_TIMEOUT_MS = 6000;
const SHORTLINK_HOSTS = new Set([
  "vm.tiktok.com", "vt.tiktok.com",
  "fb.watch", "fb.me",
  "pin.it",
  "redd.it",
  "dai.ly",
  "t.co",
  "instagr.am", "ig.me",
  "spoti.fi",
  "lnkd.in",
  "snd.sc", "on.soundcloud.com",
  "tmblr.co",
  "v.douyin.com",
  "t.snapchat.com",
]);
const HOST_REWRITES = [
  { test: /^(m|mobile|touch)\.facebook\.com$/i,   to: "www.facebook.com" },
  { test: /^web\.facebook\.com$/i,                to: "www.facebook.com" },
  { test: /^facebook\.com$/i,                     to: "www.facebook.com" },
  { test: /^[a-z]{2}(-[a-z]{2})?\.facebook\.com$/i, to: "www.facebook.com" },
  { test: /^m\.instagram\.com$/i,                 to: "www.instagram.com" },
  { test: /^instagram\.com$/i,                    to: "www.instagram.com" },
  { test: /^(m|old|amp|np)\.reddit\.com$/i,        to: "www.reddit.com" },
  { test: /^reddit\.com$/i,                       to: "www.reddit.com" },
  { test: /^m\.pinterest\.com$/i,                 to: "www.pinterest.com" },
  { test: /^pinterest\.com$/i,                    to: "www.pinterest.com" },
  { test: /^[a-z]{2}\.pinterest\.com$/i,          to: "www.pinterest.com" },
  { test: /^m\.tiktok\.com$/i,                    to: "www.tiktok.com" },
  { test: /^tiktok\.com$/i,                       to: "www.tiktok.com" },
  { test: /^mobile\.twitter\.com$/i,              to: "twitter.com" },
  { test: /^m\.twitter\.com$/i,                   to: "twitter.com" },
  { test: /^mobile\.x\.com$/i,                    to: "x.com" },
  { test: /^m\.soundcloud\.com$/i,                to: "soundcloud.com" },
  { test: /^m\.dailymotion\.com$/i,               to: "www.dailymotion.com" },
  { test: /^dailymotion\.com$/i,                  to: "www.dailymotion.com" },
  { test: /^m\.linkedin\.com$/i,                  to: "www.linkedin.com" },
  { test: /^linkedin\.com$/i,                     to: "www.linkedin.com" },
  { test: /^m\.douyin\.com$/i,                    to: "www.douyin.com" },
  { test: /^douyin\.com$/i,                       to: "www.douyin.com" },
  { test: /^m\.snapchat\.com$/i,                  to: "www.snapchat.com" },
  { test: /^snapchat\.com$/i,                     to: "www.snapchat.com" },
  { test: /^capcut\.com$/i,                       to: "www.capcut.com" },
  { test: /^threads\.net$/i,                      to: "www.threads.net" },
  { test: /^threads\.com$/i,                      to: "www.threads.com" },
  { test: /^bluesky\.app$/i,                      to: "bsky.app" },
];
const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "igshid", "igsh", "si", "ref", "ref_src", "ref_url",
  "spm", "s", "t", "cd", "context", "feature", "source", "cvid", "app",
  "is_from_webapp", "sender_device", "_r", "_t", "mibextid",
]);
function stripTrackingParams(u) {
  const toDelete = [];
  for (const key of u.searchParams.keys()) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower) || TRACKING_PARAM_PREFIXES.some(p => lower.startsWith(p))) {
      toDelete.push(key);
    }
  }
  for (const key of toDelete) u.searchParams.delete(key);
  return u;
}
function rewriteHost(u) {
  const host = u.hostname.toLowerCase();
  const rule = HOST_REWRITES.find(r => r.test.test(host));
  if (rule) u.hostname = rule.to;
  return u;
}
async function resolveShortlink(rawUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIRECT_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(rawUrl, { method: "HEAD", redirect: "follow", signal: controller.signal });
    } catch (_) {
      res = await fetch(rawUrl, { method: "GET", redirect: "follow", signal: controller.signal });
      res.body?.cancel?.().catch(() => {});
    }
    if (res?.url) return res.url;
    return rawUrl;
  } catch (_) {
    return rawUrl;
  } finally {
    clearTimeout(timer);
  }
}
/**
 * Normalize a media URL to its canonical form before it's sent to any
 * downloader/resolver API. Safe to call for every platform; unknown hosts
 * are returned with only tracking-param stripping applied.
 */
async function normalizeMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  let current = rawUrl.trim();
  let u;
  try { u = new URL(current); } catch { return current; }
  if (SHORTLINK_HOSTS.has(u.hostname.toLowerCase())) {
    const resolved = await resolveShortlink(current);
    try { u = new URL(resolved); } catch {  }
  }
  u = rewriteHost(u);
  u = stripTrackingParams(u);
  u.hash = "";
  let result = u.toString();
  if (result.endsWith("/") && !current.replace(/\?.*$/, "").endsWith("/")) {
    result = result.slice(0, -1);
  }
  return result;
}
export { normalizeMediaUrl };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-utils-url-normalizer',
  meta: { category: 'utils', path: 'src/utils/urlNormalizer.js' },
  setup(_ctx) {
    // provides: normalizeMediaUrl
  },
};
