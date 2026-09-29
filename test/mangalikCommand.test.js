import test from "node:test";
import assert from "node:assert/strict";
import mangalikCommand, { buildMangaFallbackArgs, invokeMangaFallback } from "../src/cmds/mangalik.js";
import mangaCommand, { MAX_PER_GROUP, sendMangaMessage } from "../src/cmds/manga.js";

test("registers the Mangalik command and limits every packet to 14 images", () => {
  assert.equal(mangalikCommand.config.name, "mangalik");
  assert.equal(mangalikCommand.config.countDown, 0);
  assert.ok(mangalikCommand.config.aliases.includes("mangalek"));
  assert.equal(MAX_PER_GROUP, 14);
});

test("constructs fallback arguments and invokes manga.js directly without re-enqueueing", async () => {
  assert.deepEqual(buildMangaFallbackArgs("One Piece", "1085"), ["One", "Piece", "1085"]);
  let invocation;
  const command = { onStart: async options => { invocation = options; return "done"; } };
  const event = { threadID: "thread", messageID: "message" };
  await invokeMangaFallback({ api: {}, event, title: "One Piece", chapter: "1085", command });
  assert.deepEqual(invocation.args, ["One", "Piece", "1085"]);
  assert.equal(invocation.bypassHumanQueue, true);
  assert.equal(invocation.event, event);
});

test("internal manga fallback uses raw sendMessage rather than the humanized safety queue", async () => {
  const original = global.safeSend;
  let sent;
  global.safeSend = () => { throw new Error("safety queue must not be used"); };
  const rawApi = {
    sendMessage(body, threadID, callback, messageID) {
      sent = { body, threadID, messageID };
      callback?.(null, { messageID: "sent" });
      return Promise.resolve({ messageID: "sent" });
    },
  };
  try {
    await new Promise((resolve, reject) => {
      sendMangaMessage({ __rawApi: rawApi }, "chapter", "thread", error => error ? reject(error) : resolve(), "reply", true);
    });
    assert.deepEqual(sent, { body: "chapter", threadID: "thread", messageID: "reply" });
  } finally {
    global.safeSend = original;
  }
});

test("manga.js remains the configured command used for fallback", () => {
  assert.equal(typeof mangaCommand.onStart, "function");
  assert.equal(mangaCommand.config.name, "manga");
});
