import { load } from "cheerio";
const STARZ_ORIGIN = "https://starzmanga.com";
const STARZ_ONE_PIECE_URL = `${STARZ_ORIGIN}/manga/one-piece/`;
const MANGALIK_ORIGIN = "https://mangalik.net";
const MANGALIK_ONE_PIECE_SLUG = "pieceone";
function normalizeMangaTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/×/g, "x")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}
function isOnePieceTitle(value) {
  const title = normalizeMangaTitle(value);
  return title.includes("onepiece") || title.includes("ونبيس") || title.includes("وانبيس");
}
function normalizeChapterSlug(value) {
  const raw = String(value || "").trim().replace(/,/g, ".");
  if (!/^\d+(?:[._-]\d+)?$/.test(raw)) return null;
  return raw.replace(/[._](?=\d+$)/, "-");
}
function buildStarzOnePieceChapterUrl(chapter) {
  const slug = normalizeChapterSlug(chapter);
  return slug ? `${STARZ_ONE_PIECE_URL}${encodeURIComponent(slug)}/` : null;
}
function buildMangalikOnePieceChapterUrl(chapter) {
  const slug = normalizeChapterSlug(chapter);
  return slug ? `${MANGALIK_ORIGIN}/manga/${MANGALIK_ONE_PIECE_SLUG}/${encodeURIComponent(slug)}/` : null;
}
function getMangaSourceOrder(title) {
  return isOnePieceTitle(title) ? ["StarzManga", "Mangalik"] : ["Mangalik"];
}
function isAllowedHost(hostname, source) {
  const host = String(hostname || "").toLowerCase();
  if (source === "StarzManga") {
    return host === "starzmanga.com" || host.endsWith(".starzmanga.com") ||
      host === "manga-starz.net" || host.endsWith(".manga-starz.net");
  }
  if (source === "Mangalik") {
    return host === "mangalik.net" || host.endsWith(".mangalik.net");
  }
  return false;
}
function normalizeReaderImageUrl(value, source, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || !isAllowedHost(url.hostname, source)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
function buildMangalikSearchUrl(title) {
  const url = new URL("/", MANGALIK_ORIGIN);
  url.searchParams.set("s", String(title || "").trim());
  url.searchParams.set("post_type", "wp-manga");
  return url.href;
}
function buildMangalikSearchTerms(title) {
  const raw = String(title || "").replace(/\s+/g, " ").trim();
  const variants = [raw];
  const crossVariant = raw.replace(/\s+[x×]\s+/gi, " × ");
  const compactCrossVariant = crossVariant.replace(/\s*×\s*/g, "×");
  const asciiVariant = raw.replace(/×/g, "x");
  if (crossVariant) variants.push(crossVariant);
  if (compactCrossVariant) variants.push(compactCrossVariant);
  if (asciiVariant) variants.push(asciiVariant);
  return [...new Set(variants)].filter(Boolean).slice(0, 4);
}
function normalizeMangalikUrl(value, base = MANGALIK_ORIGIN) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || !isAllowedHost(url.hostname, "Mangalik")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}
function similarity(a, b) {
  const left = normalizeMangaTitle(a);
  const right = normalizeMangaTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.5;
  const aPairs = [];
  const bPairs = [];
  for (let i = 0; i < left.length - 1; i++) aPairs.push(left.slice(i, i + 2));
  for (let i = 0; i < right.length - 1; i++) bPairs.push(right.slice(i, i + 2));
  if (!aPairs.length || !bPairs.length) return 0;
  const counts = new Map();
  for (const pair of bPairs) counts.set(pair, (counts.get(pair) || 0) + 1);
  let matches = 0;
  for (const pair of aPairs) {
    const count = counts.get(pair) || 0;
    if (count) {
      matches++;
      counts.set(pair, count - 1);
    }
  }
  return (2 * matches) / (aPairs.length + bPairs.length);
}
function parseMangalikSearchResults(html) {
  const $ = load(String(html || ""));
  const results = new Map();
  $("a[href*='/manga/']").each((_, element) => {
    const anchor = $(element);
    const url = normalizeMangalikUrl(anchor.attr("href"));
    if (!url) return;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2 || segments[0] !== "manga") return;
    const container = anchor.closest(".c-tabs-item");
    const title = container.find(".post-title a").first().text().trim() ||
      anchor.attr("title") || anchor.find("img").attr("alt") || anchor.text().trim() ||
      decodeURIComponent(segments[1]).replace(/[-_]+/g, " ");
    const canonicalUrl = `${MANGALIK_ORIGIN}/manga/${segments[1]}/`;
    if (!results.has(canonicalUrl)) results.set(canonicalUrl, { title, url: canonicalUrl });
  });
  return [...results.values()];
}
function pickBestMangalik(title, candidates, minimumScore = 0.22) {
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates || []) {
    let slug = "";
    try { slug = new URL(candidate.url).pathname.split("/").filter(Boolean).at(-1) || ""; } catch {}
    const score = Math.max(similarity(title, candidate.title), similarity(title, slug));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= minimumScore ? { manga: best, score: bestScore } : { manga: null, score: bestScore };
}
function buildMangalikChapterUrl(mangaUrl, chapter) {
  const safeUrl = normalizeMangalikUrl(mangaUrl);
  const slug = normalizeChapterSlug(chapter);
  if (!safeUrl || !slug) return null;
  const segments = safeUrl.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0] !== "manga") return null;
  return `${MANGALIK_ORIGIN}/manga/${segments[1]}/${encodeURIComponent(slug)}/`;
}
function normalizeChapterNumber(value) {
  return String(value || "").trim().replace(/,/g, ".").replace(/[ _-](?=\d+$)/, ".");
}
function findMangalikChapterRedirect(html, mangaUrl, chapter) {
  const target = normalizeChapterNumber(chapter);
  const $ = load(String(html || ""));
  let result = null;
  $("select.single-chapter-select option[data-redirect]").each((_, element) => {
    if (result) return;
    const option = $(element);
    const redirect = normalizeMangalikUrl(option.attr("data-redirect"), mangaUrl);
    if (!redirect) return;
    const lastSegment = decodeURIComponent(redirect.pathname.split("/").filter(Boolean).at(-1) || "");
    if ([option.text().trim(), option.attr("value"), lastSegment].some(value => normalizeChapterNumber(value) === target)) {
      result = redirect.href;
    }
  });
  return result;
}
function extractReaderImages(html, chapterUrl, source) {
  const $ = load(String(html || ""));
  const images = [];
  const seen = new Set();
  $(".reading-content img.wp-manga-chapter-img, .reading-content .page-break img").each((_, element) => {
    const image = $(element);
    const raw = image.attr("data-src") || image.attr("data-lazy-src") || image.attr("data-original") || image.attr("src");
    const url = normalizeReaderImageUrl(raw, source, chapterUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push(url);
  });
  return images;
}
function getFirecrawlHtml(response) {
  const html = response?.data?.html ?? response?.html;
  return typeof html === "string" ? html : "";
}
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const KEY_ENV_NAMES = ["FIRECRAWL_API", "FIRECRAWL_API_KEYS", "FIRECRAWL_API_KEY", "FIRECRUL_API"];
const FAILOVER_STATUSES = new Set([401, 402, 403, 429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;
class FirecrawlClientError extends Error {
  constructor(message, { code = "FIRECRAWL_ERROR", statusCode = null, keyIndex = null } = {}) {
    super(message);
    this.name = "FirecrawlClientError";
    this.code = code;
    this.statusCode = statusCode;
    this.keyIndex = keyIndex;
  }
}
function parseFirecrawlKeys(env = process.env) {
  const keys = [];
  const seen = new Set();
  for (const name of KEY_ENV_NAMES) {
    for (const entry of String(env?.[name] ?? "").split(",")) {
      const key = entry.trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}
function createFirecrawlClient({
  getApiKeys = parseFirecrawlKeys,
  fetchImpl = (...args) => globalThis.fetch(...args),
  baseUrl = FIRECRAWL_SCRAPE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let nextKeyIndex = 0;
  async function scrape(url, options = {}) {
    const keys = getApiKeys();
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new FirecrawlClientError("Firecrawl API keys are not configured.", {
        code: "FIRECRAWL_NOT_CONFIGURED",
      });
    }
    const startIndex = nextKeyIndex % keys.length;
    nextKeyIndex = (startIndex + 1) % keys.length;
    let lastError = null;
    for (let offset = 0; offset < keys.length; offset++) {
      const keyIndex = (startIndex + offset) % keys.length;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${keys[keyIndex]}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            formats: ["html"],
            onlyMainContent: false,
            maxAge: 0,
            timeout: timeoutMs,
            ...options,
          }),
          signal: controller.signal,
        });
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new FirecrawlClientError("Firecrawl returned an invalid response.", {
            code: "FIRECRAWL_INVALID_RESPONSE",
            statusCode: response.status || null,
            keyIndex,
          });
        }
        if (!response.ok || payload?.success === false) {
          const statusCode = Number(response.status) || Number(payload?.statusCode) || null;
          const failure = new FirecrawlClientError(
            statusCode ? `Firecrawl request failed (HTTP ${statusCode}).` : "Firecrawl request failed.",
            { code: "FIRECRAWL_REQUEST_FAILED", statusCode, keyIndex },
          );
          lastError = failure;
          if (!FAILOVER_STATUSES.has(statusCode) || offset === keys.length - 1) throw failure;
          continue;
        }
        nextKeyIndex = (keyIndex + 1) % keys.length;
        return payload;
      } catch (error) {
        if (error instanceof FirecrawlClientError) {
          lastError = error;
          if (!FAILOVER_STATUSES.has(error.statusCode) || offset === keys.length - 1) throw error;
          continue;
        }
        const timedOut = error?.name === "AbortError" || controller.signal.aborted;
        throw new FirecrawlClientError(
          timedOut ? "Firecrawl request timed out." : "Firecrawl could not be reached.",
          { code: timedOut ? "FIRECRAWL_TIMEOUT" : "FIRECRAWL_NETWORK", keyIndex },
        );
      } finally {
        clearTimeout(timer);
      }
    }
    nextKeyIndex = (startIndex + 1) % keys.length;
    throw lastError || new FirecrawlClientError("Firecrawl request failed.");
  }
  return { scrape };
}
const firecrawlClient = createFirecrawlClient();
export {
  isOnePieceTitle, buildStarzOnePieceChapterUrl, buildMangalikOnePieceChapterUrl, getMangaSourceOrder,
  normalizeReaderImageUrl, buildMangalikSearchUrl, buildMangalikSearchTerms, parseMangalikSearchResults,
  pickBestMangalik, buildMangalikChapterUrl, findMangalikChapterRedirect, extractReaderImages, getFirecrawlHtml,
  FirecrawlClientError, firecrawlClient,
};
