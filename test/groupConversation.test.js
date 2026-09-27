import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGroupPrompt,
  formatGroupTurn,
  formatThreadHistory,
  resolveGroupUsername,
  sanitizeGroupName,
} from "../src/utils/groupConversation.js";

test("sanitizes group speaker names and tags each turn", () => {
  assert.equal(sanitizeGroupName("Layla\n[admin]"), "Laylaadmin");
  assert.equal(formatGroupTurn("Omar", "  مرحباً  "), "[Omar]: مرحباً");
});

test("formats shared thread history with each member name", () => {
  const history = [
    { role: "user", username: "ليلى", content: "اقترحي فكرة" },
    { role: "assistant", content: "فكرة أولى" },
    { role: "user", content: "[عمر]: أضف جانباً عملياً" },
  ];
  assert.equal(
    formatThreadHistory(history),
    "[ليلى]: اقترحي فكرة\nالبوت: فكرة أولى\n[عمر]: أضف جانباً عملياً",
  );
  assert.equal(formatThreadHistory(history, 0), "");
});

test("builds a group prompt that preserves prior and current speakers", () => {
  const prompt = buildGroupPrompt(
    [{ role: "user", username: "ليلى", content: "نريد خطة" }, { role: "assistant", content: "لنبدأ" }],
    "عمر",
    "أضف ميزانية",
  );
  assert.match(prompt, /\[ليلى\]: نريد خطة/);
  assert.match(prompt, /البوت: لنبدأ/);
  assert.match(prompt, /\[عمر\]: أضف ميزانية/);
  assert.match(prompt, /محادثة جماعية/);
});

test("resolves a Messenger display name from callback-style user info", async () => {
  const api = {
    getUserInfo(id, callback) {
      callback(null, { [id]: { name: "سارة" } });
    },
  };
  assert.equal(await resolveGroupUsername(api, { senderID: "user-9876" }), "سارة");
});

test("uses a distinct safe fallback when user info is unavailable", async () => {
  const api = { getUserInfo(_id, callback) { callback(new Error("offline")); } };
  assert.equal(await resolveGroupUsername(api, { senderID: "member-4321" }), "عضو 4321");
});

test("does not duplicate a legacy speaker tag when metadata is present", () => {
  assert.equal(
    formatThreadHistory([{ role: "user", username: "ليلى", content: "[ليلى]: الفكرة الأولى" }]),
    "[ليلى]: الفكرة الأولى",
  );
});
