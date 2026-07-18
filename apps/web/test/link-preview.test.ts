import assert from "node:assert/strict";
import test from "node:test";

import { extractExternalUrls, isXPostUrl, normalizeExternalUrl, splitMessageLinks } from "../lib/link-preview";

test("extracts unique external links without chat punctuation", () => {
  assert.deepEqual(extractExternalUrls("See https://example.com/a, then (https://x.com/fulltime/status/12345). https://example.com/a"), ["https://example.com/a", "https://x.com/fulltime/status/12345"]);
  assert.equal(isXPostUrl("https://twitter.com/fulltime/status/12345?s=20"), true);
  assert.equal(isXPostUrl("https://x.com/fulltime"), false);
});

test("splits message links while preserving surrounding text", () => {
  assert.deepEqual(splitMessageLinks("Watch https://example.com/match!"), [
    { text: "Watch " },
    { text: "https://example.com/match", url: "https://example.com/match" },
    { text: "!" },
  ]);
  assert.equal(normalizeExternalUrl("javascript:alert(1)"), null);
});
