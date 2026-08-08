import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  escapeRegexLiteral,
  evaluateRegex,
  evaluateRegexPredicate,
  guidedTokenToPattern,
  isRegexEvaluation,
  localizedPrefixedRegexEvaluationError,
  normalizeRegexEvaluationRequest,
  normalizeRegexFlags,
  REGEX_MAX_CAPTURE_CODE_UNITS,
  validateRegexPattern,
} from "../../shared/regex";
import { evaluateRegexBatchIsolated } from "../regex/RegexWorkerClient";

const execFileAsync = promisify(execFile);

test("escapes literal search text for the JavaScript dialect", () => {
  assert.equal(escapeRegexLiteral("a+b?.txt"), "a\\+b\\?\\.txt");
  assert.equal(normalizeRegexFlags("uigii"), "giu");
});

test("localizes prefixed worker failures without duplicating bilingual detail", () => {
  const failure = "History regular expression evaluation failed: Regular expression evaluation timed out.";
  const localized = localizedPrefixedRegexEvaluationError(
    failure,
    "History regular expression evaluation failed: ",
    "History regex filter failed",
    "紀錄正則篩選失敗",
    (english, cantonese) => `${english} · ${cantonese}`
  );
  assert.equal(
    localized,
    "History regex filter failed: Regular expression evaluation timed out. · 紀錄正則篩選失敗：正規表示式評估逾時，請簡化模式再試。"
  );
  assert.equal(
    localizedPrefixedRegexEvaluationError("Invalid history export format", "History regular expression evaluation failed: ", "unused", "未使用", (_english, cantonese) => cantonese),
    "Invalid history export format"
  );
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
  assert.equal(validateRegexPattern("\\.(?:zip|7z|rar)(?:[?#]|$)", "i"), null);
});

test("rejects ambiguous repeated alternatives before synchronous matching", () => {
  assert.match(validateRegexPattern("(a|aa)+$", "g") ?? "", /ambiguous|backtracking/i);
  assert.match(validateRegexPattern("(?:a|ab){2,}", "g") ?? "", /ambiguous|backtracking/i);
  assert.equal(validateRegexPattern("(?:a|b)+", "g"), null);

  const result = evaluateRegex("(a|aa)+$", "g", "a".repeat(10_000));
  assert.match(result.error ?? "", /ambiguous|backtracking/i);
  assert.deepEqual(result.matches, []);
});

test("rejects long sequential optional quantifiers before synchronous matching", () => {
  const repeatedOptional = "a?".repeat(16);
  assert.match(validateRegexPattern(repeatedOptional, "g") ?? "", /optional|backtracking/i);

  const result = evaluateRegex(repeatedOptional, "g", "a".repeat(100_001));
  assert.match(result.error ?? "", /optional|backtracking/i);
  assert.deepEqual(result.matches, []);
  assert.equal(result.normalizedSample.length, 100_000);
  assert.equal(result.truncated, true);
});

test("rejects overlapping sequential quantifiers before synchronous matching", () => {
  const overlapping = "^a+a+a+a+a+a+a+a+a+a+b$";
  assert.match(validateRegexPattern(overlapping, "") ?? "", /overlapping|backtracking/i);

  const result = evaluateRegex(overlapping, "", "a".repeat(80));
  assert.match(result.error ?? "", /overlapping|backtracking/i);
  assert.deepEqual(result.matches, []);
});

test("accepts provably disjoint shorthand complements without weakening overlap checks", () => {
  for (const flags of ["", "i", "u", "iu"]) {
    for (const pair of [["\\d", "\\D"], ["\\s", "\\S"], ["\\w", "\\W"]] as const) {
      assert.equal(validateRegexPattern(`${pair[0]}+${pair[1]}+`, flags), null, `${pair.join("/")} rejected with ${flags}`);
      assert.equal(validateRegexPattern(`${pair[1]}+${pair[0]}+`, flags), null, `${[...pair].reverse().join("/")} rejected with ${flags}`);
    }
  }
  assert.match(validateRegexPattern("\\d+\\w+", "") ?? "", /overlapping|backtracking/i);
});

test("isolated regex worker responds, times out within its bound, and recovers", async () => {
  const heartbeat = await evaluateRegexBatchIsolated("needle", "i", ["haystack", "NEEDLE"], true, 2_000);
  assert.equal(heartbeat[0].error, null);
  assert.deepEqual(heartbeat[0].matches, []);
  assert.equal(heartbeat[1].matches[0]?.text, "NEEDLE");

  const nestedCaptures = `${"(".repeat(100)}a+${")".repeat(100)}`;
  const boundedPredicate = await evaluateRegexBatchIsolated(nestedCaptures, "", ["a".repeat(100_000)], false, 2_000);
  assert.equal(boundedPredicate[0].error, null);
  assert.equal(boundedPredicate[0].matches.length, 1);
  assert.equal(boundedPredicate[0].normalizedSample, "");
  assert.ok(JSON.stringify(boundedPredicate).length < 1_000, "worker match-only output must not clone captures or samples");

  const timeoutSamples = Array.from({ length: 64 }, () => "a".repeat(100_000));
  const startedAt = Date.now();
  const timedOut = await evaluateRegexBatchIsolated("z$", "", timeoutSamples, false, 0);
  assert.ok(Date.now() - startedAt < 1_000, "worker timeout must settle inside a bounded interval");
  assert.match(timedOut[0].error ?? "", /timed out/i);
  assert.deepEqual(timedOut[0].matches, []);

  const recovered = await evaluateRegexBatchIsolated("(n)(eedle)", "g", ["needle"], true, 2_000);
  assert.equal(recovered[0].error, null);
  assert.deepEqual(recovered[0].matches[0], { index: 0, text: "needle", captures: ["n", "eedle"] });
});

test("production regex deadline starts after fresh workers are ready under concurrent load", async () => {
  const workerClientModule = path.resolve(__dirname, "..", "regex", "RegexWorkerClient.js");
  const script = [
    "const { evaluateRegexBatchIsolated } = require(process.argv[1]);",
    "(async () => {",
    "  const first = await evaluateRegexBatchIsolated('needle', 'i', ['NEEDLE'], true);",
    "  const timeout = await evaluateRegexBatchIsolated('z$', '', Array.from({ length: 64 }, () => 'a'.repeat(100000)), false, 0);",
    "  const recovered = await evaluateRegexBatchIsolated('needle', '', ['needle'], true, 2000);",
    "  process.stdout.write(JSON.stringify({ first: first[0]?.matches[0]?.text, timeout: timeout[0]?.error, recovered: recovered[0]?.matches[0]?.text }));",
    "})().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });",
  ].join("\n");
  const attempts = await Promise.all(Array.from({ length: 4 }, () => execFileAsync(
    process.execPath,
    ["-e", script, workerClientModule],
    { timeout: 20_000, windowsHide: true },
  )));
  for (const { stdout } of attempts) {
    assert.deepEqual(JSON.parse(stdout), {
      first: "NEEDLE",
      timeout: "Regular expression evaluation timed out.",
      recovered: "needle",
    });
  }
});

test("bounds sample and result sizes", () => {
  const result = evaluateRegex("a", "g", "a".repeat(205));
  assert.equal(result.matches.length, 200);
  assert.equal(result.truncated, true);
});

test("match-only filtering omits sample and captures while full results cap capture output", () => {
  const nestedCaptures = `${"(".repeat(100)}a+${")".repeat(100)}`;
  const sample = "a".repeat(100_000);

  const predicate = evaluateRegexPredicate(nestedCaptures, "", sample);
  assert.equal(predicate.error, null);
  assert.equal(predicate.matches.length, 1);
  assert.equal(predicate.matches[0].text, "");
  assert.deepEqual(predicate.matches[0].captures, []);
  assert.equal(predicate.normalizedSample, "");
  assert.ok(JSON.stringify(predicate).length < 500, "match-only output must remain constant-sized");

  const full = evaluateRegex(nestedCaptures, "", sample);
  assert.equal(full.error, null);
  assert.equal(full.truncated, true);
  assert.ok(full.matches[0].captures.reduce((total, capture) => total + (capture?.length ?? 0), 0) <= REGEX_MAX_CAPTURE_CODE_UNITS);
  assert.ok(JSON.stringify(full).length < 400_000, "full builder output must remain bounded");
  assert.equal(isRegexEvaluation(full), true);
});

test("IPC request and response bounds allow predicate batches but only one full-result sample", () => {
  assert.deepEqual(normalizeRegexEvaluationRequest("needle", "i", ["one", "two"], false), {
    pattern: "needle",
    flags: "i",
    samples: ["one", "two"],
    includeMatches: false,
  });
  assert.equal(normalizeRegexEvaluationRequest("(needle)", "g", ["needle"], true).samples.length, 1);
  assert.throws(
    () => normalizeRegexEvaluationRequest("(needle)", "g", ["needle", "needle"], true),
    /exactly one bounded sample/i,
  );
  assert.throws(
    () => normalizeRegexEvaluationRequest("(needle)", "g", [], true),
    /exactly one bounded sample/i,
  );
  assert.equal(isRegexEvaluation({
    error: null,
    truncated: false,
    normalizedSample: "a",
    matches: [{ index: 0, text: "a", captures: ["x".repeat(REGEX_MAX_CAPTURE_CODE_UNITS + 1)] }],
  }), false);
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
  assert.equal(validateRegexPattern("a?a?a?", "g"), null);
  assert.equal(validateRegexPattern("(?:one|two)+", "g"), null);
});
