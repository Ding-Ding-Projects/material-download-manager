export const REGEX_LIMITS = Object.freeze({
  pattern: 256,
  flags: 12,
  sample: 2048,
  matches: 50,
  evaluationMs: 100,
});

const FRAGMENTS = Object.freeze([
  { id: "literal", label: "Literal", insert: "text" },
  { id: "characterClass", label: "Character class", insert: "[a-z]" },
  { id: "anchorStart", label: "Start anchor", insert: "^" },
  { id: "group", label: "Group", insert: "(...)" },
  { id: "alternation", label: "Alternation", insert: "|" },
  { id: "quantifier", label: "Quantifier", insert: "+" },
]);

export function regexFragments() {
  return FRAGMENTS.map((fragment) => ({ ...fragment }));
}

function hasKnownCatastrophicShape(pattern) {
  return /\([^()]{0,96}[+*](?:\??)\)[+*{]/.test(pattern) || /\.\*[+*{]/.test(pattern);
}

export function validateRegex(pattern, flags = "") {
  if (typeof pattern !== "string" || pattern.length === 0) {
    return { valid: false, error: "Enter a pattern before evaluating it." };
  }
  if (pattern.length > REGEX_LIMITS.pattern) {
    return { valid: false, error: `Patterns are limited to ${REGEX_LIMITS.pattern} characters.` };
  }
  if (typeof flags !== "string" || flags.length > REGEX_LIMITS.flags) {
    return { valid: false, error: `Flags are limited to ${REGEX_LIMITS.flags} characters.` };
  }
  if (hasKnownCatastrophicShape(pattern)) {
    return { valid: false, error: "This nested quantifier shape is blocked to keep local search responsive." };
  }
  try {
    const regex = new RegExp(pattern, flags);
    return { valid: true, regex, error: null };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "The pattern or flags are invalid." };
  }
}

export function evaluateRegex(pattern, flags, sample) {
  if (typeof sample !== "string" || sample.length > REGEX_LIMITS.sample) {
    return { valid: false, error: `Sample text is limited to ${REGEX_LIMITS.sample} characters.` };
  }
  const validation = validateRegex(pattern, flags);
  if (!validation.valid) return validation;

  const started = Date.now();
  const matches = [];
  const regex = validation.regex;
  let match;
  do {
    match = regex.exec(sample);
    if (!match) break;
    matches.push({ text: match[0], index: match.index, captures: match.slice(1) });
    if (matches.length >= REGEX_LIMITS.matches) break;
    if (Date.now() - started > REGEX_LIMITS.evaluationMs) {
      return { valid: false, error: "Evaluation exceeded the local time budget." };
    }
    if (!regex.global) break;
    if (match[0] === "") regex.lastIndex += 1;
  } while (regex.lastIndex <= sample.length);

  return { valid: true, error: null, matches, truncated: matches.length >= REGEX_LIMITS.matches };
}

export function appendRegexFragment(pattern, fragmentId) {
  const fragment = FRAGMENTS.find((item) => item.id === fragmentId);
  return `${pattern ?? ""}${fragment?.insert ?? ""}`;
}
