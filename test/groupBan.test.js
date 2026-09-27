import test from "node:test";
import assert from "node:assert/strict";
import { isGroupUnbanRequest } from "../src/utils/banList.js";

test("only a developer can bypass a banned-group gate for unban", () => {
  global.getUserRole = (uid) => String(uid) === "dev" ? 2 : 0;
  assert.equal(isGroupUnbanRequest({ isGroup: true, body: ".ban ungroup", senderID: "dev" }), true);
  assert.equal(isGroupUnbanRequest({ isGroup: true, body: "ban unblock-group", senderID: "dev" }), true);
  assert.equal(isGroupUnbanRequest({ isGroup: true, body: "group unban", senderID: "member" }), false);
  assert.equal(isGroupUnbanRequest({ isGroup: true, body: "group unban", senderID: "dev" }), false);
  assert.equal(isGroupUnbanRequest({ isGroup: false, body: "group unban", senderID: "dev" }), false);
});
