import test from "node:test";
import assert from "node:assert/strict";
import { providers, searchWithFallback } from "../src/utils/ytProviders.js";

function saveMethods() {
  return providers.map(provider => ({ provider, search: provider.search }));
}

function restoreMethods(saved) {
  for (const item of saved) {
    if (item.search === undefined) delete item.provider.search;
    else item.provider.search = item.search;
  }
}

test("YouTube search coalesces concurrent identical queries and caches short-lived results", async () => {
  const saved = saveMethods();
  const query = `cache-regression-${Date.now()}`;
  let calls = 0;
  try {
    providers[0].search = async (_query, limit) => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 20));
      return [{ url: "https://www.youtube.com/watch?v=cachetest", title: "Original", limit }];
    };
    for (const provider of providers.slice(1)) {
      provider.search = async () => { throw new Error("fallback should not be called"); };
    }

    const [first, concurrent] = await Promise.all([
      searchWithFallback(query, 1),
      searchWithFallback(query, 1),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(first, concurrent);

    first[0].title = "mutated";
    const cached = await searchWithFallback(query, 1);
    assert.equal(calls, 1);
    assert.equal(cached[0].title, "Original");
  } finally {
    restoreMethods(saved);
  }
});
