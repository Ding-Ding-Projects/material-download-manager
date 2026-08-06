import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeRegexLiteral,
  evaluateRegex,
  guidedTokenToPattern,
  validateRegexPattern,
} from "../../shared/regex";

test("escapes literal search text for the JavaScript dialect", () => {
  assert.equal(escapeRegexLiteral("a+b?.txt"), "a\\+b\\?\\.txt");
});

test("evaluates captures and keeps zero-width matches finite", () => {
  const captured = evaluateRegex("(a)(b)", "g", "ab ab");
  assert.equal(captured.error, null);
  assert.deepEqual(captured.matches[0], { index: 0, text: "ab", captures: ["a", "b"] });

  const zeroWidth = evaluateRegex("^|$", "g", "abc");
  assert.equal(zeroWidth.error, null);
  assert.equal(zeroWidth.matches.length, 2);
});

test("rejects invalid, oversized, and unsafe patterns before evaluation", () => {
  assert.match(validateRegexPattern("(", "g") ?? "", /unterminated|Invalid/i);
  assert.match(validateRegexPattern("x".repeat(2049), "g") ?? "", /2048/);
  assert.match(validateRegexPattern("(a+)+", "g") ?? "", /nested quantifiers/i);
});

test("bounds sample and result sizes", () => {
  const result = evaluateRegex("a", "g", "a".repeat(205));
  assert.equal(result.matches.length, 200);
  assert.equal(result.truncated, true);
});

test("guided tokens produce valid composable fragments", () => {
  assert.equal(guidedTokenToPattern({ kind: "characterClass", value: "a-z" }), "[a\\-z]");
  assert.equal(guidedTokenToPattern({ kind: "alternation", left: "one", right: "two" }), "(?:one|two)");
  assert.equal(guidedTokenToPattern({ kind: "quantifier", atom: "x", min: 1, max: 3, lazy: true }), "x{1,3}?");
});
