import test from "node:test";
import assert from "node:assert/strict";
import { buildCommandContext, getReplyTargetID } from "../src/core/Context.js";
import unsendCommand from "../src/cmds/unsend.js";

function captureSafeSend(t) {
  const previous = global.safeSend;
  const calls = [];
  global.safeSend = (api, body, threadID, callback, messageID) => {
    calls.push({ api, body, threadID, messageID });
    callback?.(null, { messageID: "bot-response" });
    return Promise.resolve({ messageID: "bot-response" });
  };
  t.after(() => {
    if (previous === undefined) delete global.safeSend;
    else global.safeSend = previous;
  });
  return calls;
}

test("a bot command replying to another user's message answers that original message", async t => {
  const calls = captureSafeSend(t);
  const api = {};
  const event = {
    threadID: "group-1",
    senderID: "user-1",
    messageID: "command-message",
    messageReply: { messageID: "user-2-message", senderID: "user-2" },
  };

  assert.equal(getReplyTargetID(event), "user-2-message");
  const context = buildCommandContext({ api, event, args: ["status"] });
  assert.equal(context.event.messageID, "user-2-message");
  assert.equal(context.event.commandMessageID, "command-message");

  await context.message.reply("bot response");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, "bot response");
  assert.equal(calls[0].threadID, "group-1");
  assert.equal(calls[0].messageID, "user-2-message");
});

test("ordinary commands still reply to their own message", async t => {
  const calls = captureSafeSend(t);
  const context = buildCommandContext({
    api: {},
    event: { threadID: "group-1", senderID: "user-1", messageID: "command-message" },
  });

  assert.equal(context.event.messageID, "command-message");
  await context.message.reply("bot response");
  assert.equal(calls[0].messageID, "command-message");
});

test("unsend preserves the user's command ID when the context points at the replied-to message", async () => {
  const deleted = [];
  const api = {
    getCurrentUserID: () => "bot-user",
    unsendMessage: (messageID, threadID) => {
      deleted.push({ messageID, threadID });
      return Promise.resolve();
    },
  };
  const context = buildCommandContext({
    api,
    event: {
      threadID: "group-1",
      senderID: "user-1",
      type: "message_reply",
      messageID: "command-message",
      messageReply: { messageID: "bot-message", senderID: "bot-user" },
    },
  });

  await unsendCommand.onStart({ api, event: context.event, message: context.message });
  assert.deepEqual(deleted, [
    { messageID: "bot-message", threadID: "group-1" },
    { messageID: "command-message", threadID: "group-1" },
  ]);
});
