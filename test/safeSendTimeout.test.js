import test from "node:test";
import assert from "node:assert/strict";

process.env.FB_SEND_TIMEOUT_MS = "80";
const { gatedSend, prioritySend } = await import("../src/utils/safeSend.js");

test("timed-out sends release regular and priority per-thread queues", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [label, send] of [["regular", gatedSend], ["priority", prioritySend]]) {
      let calls = 0;
      const api = {
        sendMessage() {
          calls += 1;
          return calls === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true });
        },
      };
      const threadID = `send-timeout-${label}-${Date.now()}`;
      await assert.rejects(send(api, "stalled", threadID), /timed out after 80ms/);
      assert.deepEqual(await send(api, "recovery", threadID), { ok: true });
      assert.equal(calls, 2, `${label} queue should attempt the next send after timeout`);
    }
  } finally {
    console.error = originalError;
  }
});
