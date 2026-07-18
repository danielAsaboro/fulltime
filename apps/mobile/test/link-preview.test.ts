import assert from "node:assert/strict";
import test from "node:test";

import { externalLinks } from "../src/link-preview";

test("mobile chat preloads unique external links and trims punctuation", () => {
  assert.deepEqual(externalLinks("Read https://example.com/a, then https://x.com/team/status/123. https://example.com/a"), [
    "https://example.com/a",
    "https://x.com/team/status/123",
  ]);
});
