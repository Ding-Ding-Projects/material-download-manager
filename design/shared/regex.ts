/**
 * Local, bounded regular-expression support shared by the renderer and the
 * Electron test build. The product's search surfaces use the JavaScript
 * RegExp dialect exposed by Chromium/Electron.
 */

export const REGEX_MAX_PATTERN_LENGTH = 2_048;
export const REGEX_MAX_SAMPLE_LENGTH = 100_000;
export const REGEX_MAX_MATCHES = 200;

export const REGEX_FLAGS = ["g", "i", "m", "s", "u", "y"] as const;
export type RegexFlag = (typeof REGEX_FLAGS)[number];

export interface RegexBuilderState {
  mode: "text" | "regex";
  pattern: string;
  flags: string;
  sample: string;
}

export interface RegexMatch {
  index: number;
  text: string;
  captures: Array<string | undefined>;
}

export interface RegexEvaluation {
  error: string | null;
  matches: RegexMatch[];
  truncated: boolean;
  normalizedSample: string;
}

export function createDefaultRegexBuilderState(): RegexBuilderState {
  return { mode: "text", pattern: "", flags: "g", sample: "" };
}

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function escapeCharacterClass(value: string): string {
  return value.replace(/[\\\]^\-]/g, "\\$&");
}

export function normalizeRegexFlags(flags: string): string {
  const seen = new Set<string>();
  for (const flag of flags) {
    if ((REGEX_FLAGS as readonly string[]).includes(flag)) seen.add(flag);
  }
  return REGEX_FLAGS.filter((flag) => seen.has(flag)).join("");
}

function hasUnsafeNestedQuantifier(pattern: string): boolean {
  // JavaScript has no portable regex timeout. Reject the common nested
  // quantifier shape before it can monopolize the renderer event loop.
  return /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*?{]/.test(pattern);
}

export function validateRegexPattern(pattern: string, flags: string): string | null {
  if (pattern.length > REGEX_MAX_PATTERN_LENGTH) {
    return `Pattern is limited to ${REGEX_MAX_PATTERN_LENGTH} characters.`;
  }
  if (hasUnsafeNestedQuantifier(pattern)) {
    return "This pattern contains nested quantifiers that may cause catastrophic backtracking.";
  }
  const unknown = [...flags].filter((flag) => !(REGEX_FLAGS as readonly string[]).includes(flag));
  if (unknown.length > 0) return `Unsupported flag: ${unknown[0]}`;
  if (new Set(flags).size !== flags.length) return "Each flag may be selected only once.";
  try {
    // Compile exactly the user-selected flags so syntax errors are reported
    // using the same engine that evaluates matches.
    new RegExp(pattern, normalizeRegexFlags(flags));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid regular expression.";
  }
}

export function evaluateRegex(pattern: string, flags: string, sample: string): RegexEvaluation {
  const normalizedSample = sample.slice(0, REGEX_MAX_SAMPLE_LENGTH);
  const validationError = validateRegexPattern(pattern, flags);
  if (validationError) {
    return { error: validationError, matches: [], truncated: sample.length > REGEX_MAX_SAMPLE_LENGTH, normalizedSample };
  }
  if (pattern.length === 0) {
    return { error: null, matches: [], truncated: sample.length > REGEX_MAX_SAMPLE_LENGTH, normalizedSample };
  }

  const evaluationFlags = normalizeRegexFlags(flags).includes("g")
    ? normalizeRegexFlags(flags)
    : `${normalizeRegexFlags(flags)}g`;
  const regex = new RegExp(pattern, evaluationFlags);
  const matches: RegexMatch[] = [];
  let result: RegExpExecArray | null;
  while ((result = regex.exec(normalizedSample)) !== null) {
    matches.push({ index: result.index, text: result[0], captures: result.slice(1) });
    if (matches.length >= REGEX_MAX_MATCHES) {
      return { error: null, matches, truncated: true, normalizedSample };
    }
    // A zero-width global match otherwise repeats forever at the same index.
    if (result[0].length === 0) regex.lastIndex += 1;
  }
  return { error: null, matches, truncated: sample.length > REGEX_MAX_SAMPLE_LENGTH, normalizedSample };
}

export type RegexGuidedToken =
  | { kind: "literal"; value: string }
  | { kind: "characterClass"; value: string; negated?: boolean }
  | { kind: "anchor"; value: "^" | "$" | "\\b" }
  | { kind: "group"; value: string; capturing?: boolean }
  | { kind: "alternation"; left: string; right: string }
  | { kind: "quantifier"; atom: string; min: number; max?: number; lazy?: boolean };

export function guidedTokenToPattern(token: RegexGuidedToken): string {
  switch (token.kind) {
    case "literal":
      return escapeRegexLiteral(token.value);
    case "characterClass":
      return `[${token.negated ? "^" : ""}${escapeCharacterClass(token.value)}]`;
    case "anchor":
      return token.value;
    case "group":
      return `${token.capturing === false ? "(?:" : "("}${token.value})`;
    case "alternation":
      return `(?:${token.left}|${token.right})`;
    case "quantifier": {
      const suffix = token.max === undefined ? `{${token.min},}` : `{${token.min},${token.max}}`;
      return `${token.atom}${suffix}${token.lazy ? "?" : ""}`;
    }
  }
}
