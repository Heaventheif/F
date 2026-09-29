import test from "node:test";
import assert from "node:assert/strict";
import { buildPages, getLiveCommands, toEntry } from "../src/cmds/help.js";
import factCommand from "../src/cmds/fact.js";

test("fact command belongs to the games and entertainment category", () => {
  assert.equal(factCommand.config.category, "ألعاب وترفيه");
  assert.match(buildPages([toEntry(factCommand)])[0], /ألعاب وترفيه\n  fact/);
});

test("help pages are compact, emoji-free, and use aligned category/name rows", () => {
  const entries = [
    toEntry({ config: { name: "admin-tool", aliases: ["ادارة 🛡️"], category: "admin", description: "Manage groups 🧰" } }),
    toEntry({ config: { name: "media-tool", category: "وسائط", description: "Download media 📥" } }),
    toEntry({ config: { name: "ai-tool", category: "ذكاء اصطناعي", description: "Ask an assistant 🤖" } }),
  ];
  const pages = buildPages(entries);
  const menu = pages.join("\n");

  assert.equal(pages.length, 1);
  assert.ok(menu.length < 300);
  assert.doesNotMatch(menu, /\p{Extended_Pictographic}/u);
  assert.match(menu, /إدارة وإشراف/);
  assert.match(menu, /وسائط وتحميل/);
  assert.ok(menu.indexOf("ذكاء اصطناعي") < menu.indexOf("وسائط وتحميل"));
  assert.ok(menu.indexOf("وسائط وتحميل") < menu.indexOf("إدارة وإشراف"));
  assert.match(menu, /  ai-tool/);
  assert.match(menu, /  media-tool/);
  assert.doesNotMatch(menu, /Manage groups|Download media|assistant/);
});

test("large help catalogs are split into short messages", () => {
  const entries = Array.from({ length: 240 }, (_, index) => ({
    name: `command-${String(index).padStart(3, "0")}`,
    aliases: [],
    desc: "A long description that should not be shown in the compact directory.",
    cat: "ذكاء اصطناعي",
  }));
  const pages = buildPages(entries);

  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.length <= 1500));
  assert.ok(pages.every((page) => !page.includes("long description")));
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
