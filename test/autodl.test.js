import test from "node:test";
import assert from "node:assert/strict";
import { extractUrlFromEvent } from "../src/cmds/autodl.js";

test("autodl ignores URLs embedded in photo/video attachment metadata", () => {
  const url = "https://cdn.example.com/member-video.mp4";
  const event = {
    type: "message",
    body: "",
    attachments: [{ type: "video", url }],
  };

  assert.equal(extractUrlFromEvent(event), null);
});

test("autodl still detects a URL explicitly sent in the message body", () => {
  const url = "https://www.youtube.com/watch?v=example";

  assert.equal(
    extractUrlFromEvent({ body: `شاهد هذا ${url}`, attachments: [] }),
    url,
  );
});

test("autodl detects a URL in the replied-to message text", () => {
  const url = "https://youtu.be/example";

  assert.equal(
    extractUrlFromEvent({ body: "", messageReply: { body: url, attachments: [] } }),
    url,
  );
});
