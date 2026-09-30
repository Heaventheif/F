import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const modulePath = fileURLToPath(new URL("../src/fca/appStatePersist.js", import.meta.url));
const envKeys = ["FB_STATE_PATH", "STATE_DIR", "FCA_STATE_KEY", "STATE_ENCRYPT_KEY", "APPSTATE_SECRET", "APPSTATE"];

test("AppState persistence honors Render path and secret settings", async () => {
  const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const originalGlobalState = globalThis.appState;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sunken-appstate-test-"));

  try {
    const explicitFile = path.join(tempRoot, "render-disk", "appstate.enc");
    process.env.FB_STATE_PATH = explicitFile;
    delete process.env.STATE_DIR;
    delete process.env.FCA_STATE_KEY;
    delete process.env.STATE_ENCRYPT_KEY;
    process.env.APPSTATE_SECRET = crypto.randomBytes(32).toString("hex");

    const explicit = await import(`${new URL(`file://${modulePath}`).href}?explicit=${Date.now()}`);
    assert.equal(explicit.STATE_FILE, explicitFile);

    const state = [
      { key: "c_user", value: "test-user-id" },
      { key: "xs", value: "test-session-cookie" },
    ];
    assert.equal(explicit.persistAppState(state, "unit-test"), true);
    assert.ok(fs.existsSync(explicitFile));
    const restored = explicit.readPersistedAppState();
    assert.equal(restored.length, state.length);
    assert.equal(restored.find(cookie => cookie.key === "c_user")?.value, "test-user-id");
    assert.equal(restored.find(cookie => cookie.key === "xs")?.value, "test-session-cookie");
    assert.doesNotMatch(fs.readFileSync(explicitFile, "utf8"), /test-user-id|test-session-cookie/);

    const extraCookie = { key: "fr", value: "retained" };
    assert.equal(explicit.persistAppState([...state, extraCookie], "unit-test"), true);
    await explicit.resolveAppState(state); // env cookies may be fewer than on disk
    assert.equal(explicit.persistAppState(state, "unit-test"), true);
    assert.equal(explicit.readPersistedAppState().find(c => c.key === "fr")?.value, "retained");
    assert.equal(explicit.persistAppState(state, "unit-test"), false);

    // Even with the same values in memory, a missing disk file must be rebuilt.
    fs.unlinkSync(explicitFile);
    await explicit.resolveAppState(state);
    assert.equal(explicit.persistAppState(state, "unit-test"), true);
    assert.ok(fs.existsSync(explicitFile));
    assert.equal(explicit.readPersistedAppState().length, state.length);
    assert.equal(explicit.persistAppState(state, "unit-test"), false);

    // Metadata changes (not only cookie values) must be persisted as well.
    const expires = Math.floor(Date.now() / 1000) + 86400;
    assert.equal(explicit.persistAppState([{ ...state[0], expires }, state[1]], "unit-test"), true);
    assert.equal(explicit.readPersistedAppState().find(c => c.key === "c_user")?.expires, expires);

    // A fresh process is needed to check a different boot-time path. Bun
    // caches modules across query-string imports, unlike Node's ESM loader.
    const stateDir = path.join(tempRoot, "state-dir-fallback");
    const fallbackPath = execFileSync(process.execPath, ["--eval",
      `import { STATE_FILE } from ${JSON.stringify(pathToFileURL(modulePath).href)}; process.stdout.write(STATE_FILE);`,
    ], { encoding: "utf8", env: { ...process.env, STATE_DIR: stateDir, FB_STATE_PATH: "" } });
    assert.equal(fallbackPath, path.join(stateDir, "appstate.enc"));
  } finally {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    if (originalGlobalState === undefined) delete globalThis.appState;
    else globalThis.appState = originalGlobalState;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
