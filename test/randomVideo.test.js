import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseRandomUnseen,
  isTikTokVideoUrl,
  parseTikTokUsers,
} from "../src/cmds/random.js";

test("TikTok random sources accept comma-separated public usernames", () => {
  assert.deepEqual(parseTikTokUsers("@nasa, duolingo, invalid handle, @nasa"), ["nasa", "duolingo"]);
  assert.deepEqual(parseTikTokUsers(""), ["nasa"]);
  assert.deepEqual(parseTikTokUsers("invalid handle"), ["nasa"]);
});

test("only canonical TikTok video URLs are accepted from profile results", () => {
  assert.equal(isTikTokVideoUrl("https://www.tiktok.com/@nasa/video/123456"), true);
  assert.equal(isTikTokVideoUrl("https://example.com/@nasa/video/123456"), false);
  assert.equal(isTikTokVideoUrl("https://www.tiktok.com/@nasa"), false);
});

test("random selection prefers unseen videos and only repeats when exhausted", () => {
  const seen = new Set(["sent"]);
  const items = [{ id: "sent" }, { id: "fresh" }];
  assert.deepEqual(chooseRandomUnseen(items, item => item.id, seen), { id: "fresh" });
  assert.equal(chooseRandomUnseen([], item => item.id, seen), null);
  assert.deepEqual(chooseRandomUnseen([{ id: "sent" }], item => item.id, seen), { id: "sent" });
});
