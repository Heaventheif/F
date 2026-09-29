import test from "node:test";
import assert from "node:assert/strict";
import { buildPages, getLiveCommands, toEntry } from "../src/cmds/help.js";

test("help pages remove emoji and list categories in a stable, normalized order", () => {
  const entries = [
    toEntry({ config: { name: "admin-tool", aliases: ["ادارة 🛡️"], category: "admin", description: "Manage groups 🧰" } }),
    toEntry({ config: { name: "media-tool", category: "وسائط", description: "Download media 📥" } }),
    toEntry({ config: { name: "ai-tool", category: "ذكاء اصطناعي", description: "Ask an assistant 🤖" } }),
  ];
  const menu = buildPages(entries).join("\n");

  assert.doesNotMatch(menu, /\p{Extended_Pictographic}/u);
  assert.match(menu, /إدارة وإشراف/);
  assert.match(menu, /وسائط وتحميل/);
  assert.ok(menu.indexOf("ذكاء اصطناعي") < menu.indexOf("وسائط وتحميل"));
  assert.ok(menu.indexOf("وسائط وتحميل") < menu.indexOf("إدارة وإشراف"));
  assert.match(menu, /Manage groups/);
});

test("live help list filters hidden and disabled commands and deduplicates aliases", () => {
  const previous = global.commands;
  const visible = { config: { name: "alpha", aliases: ["a"] } };
  const hidden = { config: { name: "hidden", hidden: true } };
  const disabled = { config: { name: "disabled", enabled: false } };
  global.commands = new Map([
    ["alpha", visible],
    ["a", visible],
    ["hidden", hidden],
    ["disabled", disabled],
  ]);
  try {
    assert.deepEqual(getLiveCommands(), [visible]);
  } finally {
    if (previous === undefined) delete global.commands;
    else global.commands = previous;
  }
});
