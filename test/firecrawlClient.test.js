import test from "node:test";
import assert from "node:assert/strict";
import { createFirecrawlClient, parseFirecrawlKeys } from "../src/utils/firecrawlClient.js";

test("parses comma-separated Firecrawl keys and removes duplicates", () => {
  assert.deepEqual(parseFirecrawlKeys({ FIRECRAWL_API: " key-a, key-b, key-a ", FIRECRAWL_API_KEY: "key-c", FIRECRUL_API: "key-d" }), ["key-a", "key-b", "key-c", "key-d"]);
});

test("rotates to the next key after a successful scrape", async () => {
  const authHeaders = [];
  const client = createFirecrawlClient({
    getApiKeys: () => ["secret-a", "secret-b"],
    timeoutMs: 1000,
    fetchImpl: async (_url, options) => {
      authHeaders.push(options.headers.Authorization);
      return { ok: true, status: 200, json: async () => ({ success: true, html: "<html></html>" }) };
    },
  });
  await client.scrape("https://example.test/1");
  await client.scrape("https://example.test/2");
  assert.deepEqual(authHeaders, ["Bearer secret-a", "Bearer secret-b"]);
});

test("fails over after an authorization error without logging or returning key values", async () => {
  const authHeaders = [];
  const client = createFirecrawlClient({
    getApiKeys: () => ["bad-secret", "good-secret"],
    timeoutMs: 1000,
    fetchImpl: async (_url, options) => {
      authHeaders.push(options.headers.Authorization);
      if (options.headers.Authorization === "Bearer bad-secret") {
        return { ok: false, status: 401, json: async () => ({ success: false }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, html: "ok" }) };
    },
  });
  const result = await client.scrape("https://example.test/chapter");
  assert.equal(result.html, "ok");
  assert.deepEqual(authHeaders, ["Bearer bad-secret", "Bearer good-secret"]);
});
