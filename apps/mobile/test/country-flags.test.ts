import assert from "node:assert/strict";
import test from "node:test";

import { countryFlag, normalizeCountryCode } from "../src/country-flags";

test("mobile country flags normalize fixture aliases without a network lookup", () => {
  assert.equal(normalizeCountryCode("NOR"), "NO");
  assert.equal(normalizeCountryCode("England"), "GB-ENG");
  assert.equal(countryFlag("NO"), "🇳🇴");
  assert.equal(countryFlag("ENG"), "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}");
  assert.equal(countryFlag(null, "France"), null);
  assert.equal(countryFlag("France"), null);
})
