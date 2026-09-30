import test from "node:test";
import assert from "node:assert/strict";
import { handleMessage, handleEvent } from "../src/core/Router.js";

function setup(t) {
  const keys = ["wrapApiForSafety", "config", "commands", "eventCommands", "Kagenou",
    "getUserRole", "checkCooldown", "setCooldown", "perfManager", "_cmdAnalytics"];
  const previous = new Map(keys.map(key => [key, global[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  });
  global.wrapApiForSafety = api => api;
  global.config = { Prefix: ["", "!"] };
  global.commands = new Map();
  global.eventCommands = [];
  global.Kagenou = { replies: {} };
  global.getUserRole = () => 0;
  global.checkCooldown = () => null;
  global.setCooldown = () => {};
  global.perfManager = null;
  global._cmdAnalytics = {};
  return {
    api: { getThreadInfo: async () => ({ adminIDs: ["admin"] }), sendMessage: async () => {} },
    event: { type: "message", threadID: "router-test-group", senderID: "user",
      isGroup: true, body: "!ping hello", messageID: "message-1" },
  };
}

test("explicit prefixes take precedence over an empty prefix", async t => {
  const { api, event } = setup(t);
  let context;
  global.commands.set("ping", { config: { countDown: 0 }, onStart: async ctx => { context = ctx; } });
  await handleMessage(api, event);
  assert.equal(context.prefix, "!");
  assert.deepEqual(context.args, ["hello"]);
});

test("message routing waits for the command before freeing its queue slot", async t => {
  const { api, event } = setup(t);
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  global.commands.set("ping", { config: { countDown: 0 }, onStart: async () => {
    started();
    await pending;
  } });
  let finished = false;
  const task = handleMessage(api, event).then(() => { finished = true; });
  await entered;
  assert.equal(finished, false);
  release();
  await task;
  assert.equal(finished, true);
});

test("event routing waits for asynchronous onChat handlers", async t => {
  const { api, event } = setup(t);
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  global.eventCommands = [{ onChat: async () => { started(); await pending; } }];
  let finished = false;
  const task = handleEvent(api, event).then(() => { finished = true; });
  await entered;
  assert.equal(finished, false);
  release();
  await task;
  assert.equal(finished, true);
});
