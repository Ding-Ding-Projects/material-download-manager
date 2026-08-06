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
  assert.match(validateRegexPattern("^(a|a?)+$", "g") ?? "", /nested quantifiers/i);
});

test("bounds sample and result sizes", () => {
  const result = evaluateRegex("a", "g", "a".repeat(205));
  assert.equal(result.matches.length, 200);
  assert.equal(result.truncated, true);
});

test("guided tokens produce valid composable fragments", () => {
  const characterClass = guidedTokenToPattern({ kind: "characterClass", value: "a-z" });
  const alternation = guidedTokenToPattern({ kind: "alternation", left: "one", right: "two" });
  const quantifier = guidedTokenToPattern({ kind: "quantifier", atom: "x", min: 1, max: 3, lazy: true });
  assert.equal(characterClass, "[a\\-z]");
  assert.equal(alternation, "(?:one|two)");
  assert.equal(quantifier, "x{1,3}?");
  assert.equal(validateRegexPattern(characterClass, "g"), null);
  assert.equal(validateRegexPattern(alternation, "g"), null);
  assert.equal(validateRegexPattern(quantifier, "g"), null);
  assert.equal(validateRegexPattern("(?:one|two)+", "g"), null);
});
