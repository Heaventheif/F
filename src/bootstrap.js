"use strict";
import "dotenv/config";
process.env.TZ ||= "Europe/Berlin";
global.__mainErrorHandlersInstalled = true;
const BENIGN_CODES = new Set(["EPIPE", "ECONNRESET", "ETIMEDOUT"]);
const WINDOW_MS = 60_000;
const MAX_FATAL = 5;
const hits = [];
function noteFatal(kind, err) {
  console.error(`[${kind}]`, err?.stack ?? err);
  const now = Date.now();
  hits.push(now);
  while (hits.length && now - hits[0] > WINDOW_MS) hits.shift();
  if (hits.length >= MAX_FATAL) {
    console.error("[FATAL] عاصفة أخطاء — خروج لإعادة تشغيل نظيفة");
    process.exit(1);
  }
}
process.on("uncaughtException", (e) =>
  BENIGN_CODES.has(e?.code) ? console.warn("[net]", e.code) : noteFatal("uncaughtException", e));
process.on("unhandledRejection", (r) =>
  BENIGN_CODES.has(r?.code) ? console.warn("[net]", r.code) : noteFatal("unhandledRejection", r));
