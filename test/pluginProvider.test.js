import test from "node:test";
import assert from "node:assert/strict";
import { registerByCategory } from "../plugin-provider.js";

test("fun plugin registry only loads existing commands and includes new commands", async () => {
  const registered = new Map();
  const pluginSystem = {
    has: name => registered.has(name),
    register: async plugin => { registered.set(plugin.name, plugin); },
  };
  await registerByCategory(pluginSystem, "fun");
  assert.ok(registered.has("xx-commands-fun-fact"));
  assert.ok(registered.has("xx-commands-fun-mangalik"));
  assert.ok(registered.has("xx-commands-fun-manga"));
  assert.equal(registered.size, 9);
});
