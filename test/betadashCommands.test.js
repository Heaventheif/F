import test from "node:test";
import assert from "node:assert/strict";
import { assertImageResponse, validateText, validateUserId, limits } from "../src/utils/betadash.js";
import { parseCanvaArgs } from "../src/cmds/canva.js";
import { parseSlapArgs } from "../src/cmds/slap.js";

test("validates bounded user IDs and text inputs", () => {
  assert.equal(validateUserId("123456789"), "123456789");
  assert.equal(validateUserId("abc"), null);
  assert.equal(validateUserId("1"), null);
  assert.equal(validateText(" hello "), "hello");
  assert.equal(validateText("x".repeat(limits.MAX_TEXT + 1)), null);
});

test("rejects non-image or suspiciously sized payloads", () => {
  assert.throws(() => assertImageResponse(Buffer.from("not image"), { "content-type": "text/plain" }));
  assert.throws(() => assertImageResponse(Buffer.alloc(limits.MAX_BODY_BYTES + 1), { "content-type": "image/png" }));
  assert.deepEqual(assertImageResponse(Buffer.alloc(100), { "content-type": "image/png" }).contentType, "image/png");
});

test("parses canva and slap options without consuming arbitrary text", () => {
  assert.deepEqual(parseCanvaArgs(["brat", "hello", "world"]), { design: "brat", text: "hello world" });
  assert.deepEqual(parseCanvaArgs(["list"]), { list: true });
  assert.deepEqual(parseSlapArgs(["slapv2", "123456"]), { design: "slapv2", target: "123456" });
  assert.deepEqual(parseSlapArgs(["list"]), { list: true });
});
