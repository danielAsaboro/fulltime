import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authorInitials, authorPalette, avatarGeometry } from "../src/author-style";
import { displayNameFromSeed, generateDisplayName, hashSeed } from "../src/peer-identity";

describe("peer-identity", () => {
  it("generates Title Case adjective-noun names", () => {
    const name = generateDisplayName(() => 0);
    assert.match(name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("is deterministic from seed", () => {
    assert.equal(displayNameFromSeed("peer-a"), displayNameFromSeed("peer-a"));
    assert.notEqual(displayNameFromSeed("peer-a"), displayNameFromSeed("peer-b"));
  });

  it("hashes stably", () => {
    assert.equal(hashSeed("fulltime"), hashSeed("fulltime"));
  });
});

describe("author-style", () => {
  it("picks stable palette and geometry", () => {
    const a = authorPalette("user-1");
    const b = authorPalette("user-1");
    assert.deepEqual(a, b);
    assert.notEqual(authorPalette("user-1").bg, authorPalette("user-2").bg);

    const g = avatarGeometry("user-1");
    assert.equal(typeof g.path, "string");
    assert.ok(g.c1r > 0);
  });

  it("initials from display name", () => {
    assert.equal(authorInitials("Dancing Meadow"), "DM");
    assert.equal(authorInitials(""), "?");
  });
});
