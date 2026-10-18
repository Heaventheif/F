"use strict";
import { Readable } from "stream";
import { promises as dns } from "dns";
import net from "net";
function _ipv4ToInt(ip) {
  const p = String(ip).split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = (n * 256) + v;
  }
  return n;
}
const _V4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([a, bits]) => [_ipv4ToInt(a), bits]);
function _v4Private(n) {
  if (n === null) return true;
  return _V4_BLOCKED.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}
function _ipv6ToBigInt(ip) {
  let s = String(ip).toLowerCase();
  const z = s.indexOf("%"); if (z >= 0) s = s.slice(0, z);
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const v4 = _ipv4ToInt(m[2]); if (v4 === null) return null;
    s = `${m[1]}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups;
  if (halves.length === 1) { if (head.length !== 8) return null; groups = head; }
  else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  }
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}
function _v6Private(ip) {
  const n = _ipv6ToBigInt(ip);
  if (n === null) return true;
  const top = (bits) => n >> BigInt(128 - bits);
  if (n === 0n || n === 1n) return true;
  if (top(7) === 0xfcn >> 1n) return true;
  if (top(10) === 0x3fan) return true;
  if (top(10) === 0x3fbn) return true;
  if (top(8) === 0xffn) return true;
  const low32 = Number(n & 0xffffffffn);
  if (top(96) === 0xffffn) return _v4Private(low32);
  if (top(96) === 0n) return _v4Private(low32);
  if (top(96) === 0x0064ff9b0000000000000000n) return _v4Private(low32);
  if (top(16) === 0x2002n) return _v4Private(Number((n >> 80n) & 0xffffffffn));
  return false;
}
function _isPrivateIp(ip) {
  const bare = String(ip).replace(/^\[|\]$/g, "");
  if (net.isIPv4(bare)) return _v4Private(_ipv4ToInt(bare));
  if (net.isIPv6(bare)) return _v6Private(bare);
  return true;
}
async function _assertSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`[SSRF] Invalid URL: ${rawUrl}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`[SSRF] Disallowed protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (_isPrivateIp(host)) throw new Error(`[SSRF] Direct private IP blocked: ${host}`);
    return;
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch (e) {
    throw new Error(`[SSRF] DNS resolution failed for ${host}: ${e.message}`);
  }
  for (const { address } of records) {
    if (_isPrivateIp(address)) {
      throw new Error(`[SSRF] Hostname ${host} resolves to private IP ${address} — blocked.`);
    }
  }
}
async function fetchFollowingSafely(url, init, maxHops = 5) {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    await _assertSafeUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !loc) return res;
    await res.body?.cancel();
    const next = new URL(loc, current).href;
    if (new URL(next).origin !== new URL(current).origin) {
      const h = { ...(init.headers || {}) };
      for (const k of Object.keys(h)) if (/^(authorization|cookie|x-internal-token)$/i.test(k)) delete h[k];
      init = { ...init, headers: h };
    }
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && init.method === "POST")) {
      init = { ...init, method: "GET", body: undefined };
    }
    current = next;
  }
  throw new Error("[SSRF] too many redirects");
}
const defaults = {
  baseURL: "",
  headers: {},
};
const interceptors = {
  request: [],
  response: [],
};
function buildUrl(url, params, baseURL) {
  const isAbsolute = /^https?:\/\//i.test(String(url));
  let finalUrl = url;
  if (!isAbsolute && baseURL) {
    finalUrl = baseURL.replace(/\/+$/, "") + "/" + String(url).replace(/^\/+/, "");
  }
  if (!params) return finalUrl;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v);
    } else {
      qs.set(key, String(value));
    }
  }
  const queryString = qs.toString();
  if (!queryString) return finalUrl;
  return finalUrl + (finalUrl.includes("?") ? "&" : "?") + queryString;
}
function defaultValidateStatus(status) {
  return status >= 200 && status < 300;
}
function wrapNetworkError(e, timeout) {
  if (e.name === "AbortError") {
    const err = new Error(`timeout of ${timeout}ms exceeded`);
    err.code = "ECONNABORTED";
    err.response = undefined;
    return err;
  }
  const err = new Error(e.message || "Network Error");
  err.code = e.cause?.code || e.code || "ENETWORK";
  err.cause = e.cause || e;
  err.response = undefined;
  return err;
}
function isRetryable(err) {
  if (err.code === "ECONNABORTED" || err.code === "ENETWORK") return true;
  if (err.response && err.response.status >= 500) return true;
  return false;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function performRequest(config) {
  const {
    url,
    method = "GET",
    headers = {},
    params,
    data,
    timeout = 0,
    responseType = "json",
    validateStatus = defaultValidateStatus,
    baseURL = defaults.baseURL,
  } = config;
  if (!url) throw new Error("fetchHttp: 'url' مطلوب");
  const finalUrl = buildUrl(url, params, baseURL);
  const finalHeaders = { ...defaults.headers, ...headers };
  let body;
  const upper = method.toUpperCase();
  if (data !== undefined && upper !== "GET" && upper !== "HEAD") {
    const isPlainObject =
      data !== null &&
      typeof data === "object" &&
      !(data instanceof Buffer) &&
      !(data instanceof URLSearchParams) &&
      !(typeof FormData !== "undefined" && data instanceof FormData) &&
      !(data instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(data);
    if (isPlainObject) {
      body = JSON.stringify(data);
      if (!Object.keys(finalHeaders).some((h) => h.toLowerCase() === "content-type")) {
        finalHeaders["Content-Type"] = "application/json";
      }
    } else {
      body = data;
    }
  }
  const controller = timeout ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
  let res;
  try {
    res = await fetchFollowingSafely(finalUrl, {
      method: upper,
      headers: finalHeaders,
      body,
      signal: controller ? controller.signal : undefined,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    throw wrapNetworkError(e, timeout);
  }
  if (timer) clearTimeout(timer);
  const status = res.status;
  const statusText = res.statusText;
  const resHeaders = Object.fromEntries(res.headers.entries());
  if (!validateStatus(status)) {
    let errData;
    try {
      const text = await res.text();
      try {
        errData = text ? JSON.parse(text) : undefined;
      } catch (_) {
        errData = text;
      }
    } catch (_) {
      errData = undefined;
    }
    const err = new Error(`Request failed with status code ${status}`);
    err.code = `ERR_BAD_STATUS_${status}`;
    err.response = { status, statusText, headers: resHeaders, data: errData };
    throw err;
  }
  let responseData;
  if (responseType === "arraybuffer") {
    responseData = Buffer.from(await res.arrayBuffer());
  } else if (responseType === "stream") {
    responseData = Readable.fromWeb(res.body);
  } else if (responseType === "text") {
    responseData = await res.text();
  } else {
    const text = await res.text();
    if (!text) {
      responseData = null;
    } else {
      try {
        responseData = JSON.parse(text);
      } catch (_) {
        responseData = text;
      }
    }
  }
  return { data: responseData, status, statusText, headers: resHeaders };
}
async function request(config = {}) {
  let finalConfig = config;
  for (const fn of interceptors.request) {
    finalConfig = (await fn(finalConfig)) || finalConfig;
  }
  const retries = finalConfig.retries ?? 0;
  const retryDelay = finalConfig.retryDelay ?? 300;
  let attempt = 0;
  while (true) {
    try {
      let res = await performRequest(finalConfig);
      for (const fn of interceptors.response) {
        res = (await fn(res)) || res;
      }
      return res;
    } catch (err) {
      if (attempt < retries && isRetryable(err)) {
        attempt++;
        await sleep(retryDelay * attempt);
        continue;
      }
      throw err;
    }
  }
}
function get(url, config = {}) {
  return request({ ...config, url, method: "GET" });
}
function post(url, data, config = {}) {
  return request({ ...config, url, method: "POST", data });
}
function put(url, data, config = {}) {
  return request({ ...config, url, method: "PUT", data });
}
function del(url, config = {}) {
  return request({ ...config, url, method: "DELETE" });
}
export { _assertSafeUrl as assertSafeUrl };
export default Object.assign(request, {
  get,
  post,
  put,
  delete: del,
  request,
  defaults,
  interceptors,
});
