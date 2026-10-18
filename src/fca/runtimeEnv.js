"use strict";
export function readAppStateFromEnv({ required = false } = {}) {
  const raw = process.env.APPSTATE;
  if (raw == null || raw.trim() === "") {
    const message = "APPSTATE is missing; provide a valid JSON cookie array.";
    if (required) throw new Error(message);
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("APPSTATE must be a non-empty JSON array.");
    const normalized = parsed.map((cookie, index) => {
      if (!cookie || typeof cookie !== "object") throw new Error(`APPSTATE cookie ${index} is not an object.`);
      const key = String(cookie.key ?? cookie.name ?? "").trim();
      const value = String(cookie.value ?? "");
      if (!key) throw new Error(`APPSTATE cookie ${index} has no key/name.`);
      return { ...cookie, key, value };
    });
    return normalized;
  } catch (error) {
    const message = `Invalid APPSTATE JSON: ${error.message}`;
    if (required) throw new Error(message, { cause: error });
    console.warn(`[APPSTATE] ${message}`);
    return null;
  }
}
export function updateAppStateInMemory(nextState) {
  if (!Array.isArray(nextState) || nextState.length === 0) throw new TypeError("Updated APPSTATE must be a non-empty array.");
  globalThis.appState = nextState;
  return nextState;
}
export default { readAppStateFromEnv, updateAppStateInMemory };
