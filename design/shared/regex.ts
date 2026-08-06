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

function readQuantifierEnd(pattern: string, start: number): number | null {
  const first = pattern[start];
  if (first === "*" || first === "+" || first === "?") {
    return pattern[start + 1] === "?" ? start + 1 : start;
  }
  if (first !== "{") return null;

  const close = pattern.indexOf("}", start + 1);
  if (close === -1) return null;
  const body = pattern.slice(start + 1, close);
  return /^\d+(?:,\d*)?$/.test(body) ? close : null;
}

function readRegexEscapeEnd(pattern: string, start: number): number {
  const escaped = pattern[start + 1];
  if (escaped === undefined) return start;

  if ((escaped === "u" || escaped === "p" || escaped === "P") && pattern[start + 2] === "{") {
    const close = pattern.indexOf("}", start + 3);
    return close === -1 ? Math.min(start + 2, pattern.length - 1) : close;
  }
  if (escaped === "k" && pattern[start + 2] === "<") {
    const close = pattern.indexOf(">", start + 3);
    return close === -1 ? Math.min(start + 2, pattern.length - 1) : close;
  }
  if (escaped === "x") return Math.min(start + 3, pattern.length - 1);
  if (escaped === "u") return Math.min(start + 5, pattern.length - 1);
  if (escaped === "c") return Math.min(start + 2, pattern.length - 1);
  return Math.min(start + 1, pattern.length - 1);
}

function hasUnsafeNestedQuantifier(pattern: string): boolean {
  // JavaScript has no portable regex timeout. Walk groups instead of relying
  // on one shallow expression: `(a|a?)+`, `((a+)+)` and the same shapes with
  // bounded or lazy quantifiers all need to be rejected before they can
  // monopolize the renderer event loop. This is intentionally conservative;
  // a group containing any quantifier may not itself be quantified.
  const groups: Array<{ containsQuantifier: boolean }> = [{ containsQuantifier: false }];

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      index = readRegexEscapeEnd(pattern, index);
      continue;
    }
    if (character === "[") {
      for (index += 1; index < pattern.length; index += 1) {
        if (pattern[index] === "\\") index += 1;
        else if (pattern[index] === "]") break;
      }
      continue;
    }
    if (character === "(") {
      groups.push({ containsQuantifier: false });
      // `?` immediately after `(` starts a JavaScript group prefix such as
      // `(?:`, `(?=`, `(?!`, or `(?<name>`, rather than quantifying an atom.
      if (pattern[index + 1] === "?") index += 1;
      continue;
    }
    if (character === ")" && groups.length > 1) {
      const group = groups.pop()!;
      const quantifierEnd = readQuantifierEnd(pattern, index + 1);
      if (group.containsQuantifier && quantifierEnd !== null) return true;

      const parent = groups[groups.length - 1];
      parent.containsQuantifier ||= group.containsQuantifier || quantifierEnd !== null;
      if (quantifierEnd !== null) index = quantifierEnd;
      continue;
    }

    const quantifierEnd = readQuantifierEnd(pattern, index);
    if (quantifierEnd !== null) {
      groups[groups.length - 1].containsQuantifier = true;
      index = quantifierEnd;
    }
  }

  return false;
}

type RegexCharacterSet =
  | { kind: "exact"; values: Set<string> }
  | { kind: "negated"; excluded: Set<string> }
  | { kind: "unknown" };

interface RegexSafetyToken {
  characters: RegexCharacterSet;
}

interface RegexGroupScan {
  containsQuantifier: boolean;
  contentStart: number;
  branchStarts: number[];
  branchEnds: number[];
}

const UNKNOWN_REGEX_CHARACTER_SET: RegexCharacterSet = { kind: "unknown" };

function literalCharacterSet(value: string): RegexCharacterSet {
  return { kind: "exact", values: new Set([value]) };
}

function readGroupContentStart(pattern: string, start: number): number {
  if (pattern[start + 1] !== "?") return start + 1;

  const prefix = pattern[start + 2];
  if (prefix === ":" || prefix === "=" || prefix === "!") return start + 3;
  if (prefix === "<") {
    const lookbehindMarker = pattern[start + 3];
    if (lookbehindMarker === "=" || lookbehindMarker === "!") return start + 4;
    const nameEnd = pattern.indexOf(">", start + 3);
    return nameEnd === -1 ? pattern.length : nameEnd + 1;
  }

  // Unknown group prefixes are left for RegExp to reject. Skipping the `?`
  // keeps the safety scan conservative without mistaking the prefix for a
  // user-authored branch.
  return start + 2;
}

function readSafetyEscape(pattern: string, start: number): { end: number; token: RegexSafetyToken } {
  const escaped = pattern[start + 1];
  const end = readRegexEscapeEnd(pattern, start);
  if (escaped === "n") return { end, token: { characters: literalCharacterSet("\n") } };
  if (escaped === "r") return { end, token: { characters: literalCharacterSet("\r") } };
  if (escaped === "t") return { end, token: { characters: literalCharacterSet("\t") } };
  if (escaped === "v") return { end, token: { characters: literalCharacterSet("\v") } };
  if (escaped === "f") return { end, token: { characters: literalCharacterSet("\f") } };
  if (escaped === "0") return { end, token: { characters: literalCharacterSet("\0") } };
  if (escaped && "^$\\.*+?()[]{}|/-".includes(escaped)) {
    return { end, token: { characters: literalCharacterSet(escaped) } };
  }

  if (escaped === "x") {
    const hex = pattern.slice(start + 2, start + 4);
    if (/^[0-9a-fA-F]{2}$/.test(hex)) {
      return { end, token: { characters: literalCharacterSet(String.fromCharCode(Number.parseInt(hex, 16))) } };
    }
  }
  if (escaped === "u") {
    const codePoint = pattern[start + 2] === "{" ? pattern.slice(start + 3, end) : pattern.slice(start + 2, start + 6);
    if (/^[0-9a-fA-F]+$/.test(codePoint)) {
      const value = Number.parseInt(codePoint, 16);
      if (value <= 0x10ffff) {
        return { end, token: { characters: literalCharacterSet(String.fromCodePoint(value)) } };
      }
    }
  }

  return { end, token: { characters: UNKNOWN_REGEX_CHARACTER_SET } };
}

function readClassCharacter(pattern: string, start: number): { end: number; value: string | null } {
  if (pattern[start] === "\\") {
    const escaped = readSafetyEscape(pattern, start);
    if (escaped.token.characters.kind === "exact" && escaped.token.characters.values.size === 1) {
      return { end: escaped.end, value: [...escaped.token.characters.values][0] };
    }
    return { end: escaped.end, value: null };
  }
  return { end: start, value: pattern[start] ?? null };
}

function readCharacterClass(pattern: string, start: number): { end: number; token: RegexSafetyToken } | null {
  let index = start + 1;
  const negated = pattern[index] === "^";
  if (negated) index += 1;

  const values = new Set<string>();
  let known = true;
  let hasCharacter = false;
  while (index < pattern.length) {
    if (pattern[index] === "]" && hasCharacter) {
      return {
        end: index,
        token: {
          characters: known
            ? negated
              ? { kind: "negated", excluded: values }
              : { kind: "exact", values }
            : UNKNOWN_REGEX_CHARACTER_SET,
        },
      };
    }

    const first = readClassCharacter(pattern, index);
    if (first.value === null) known = false;
    hasCharacter = true;
    index = first.end + 1;

    if (pattern[index] === "-" && pattern[index + 1] !== "]" && pattern[index + 1] !== undefined) {
      const second = readClassCharacter(pattern, index + 1);
      if (first.value === null || second.value === null || first.value.length !== 1 || second.value.length !== 1) {
        known = false;
      } else {
        const from = first.value.charCodeAt(0);
        const to = second.value.charCodeAt(0);
        if (from > to || to - from > 512) {
          known = false;
        } else {
          for (let code = from; code <= to; code += 1) values.add(String.fromCharCode(code));
        }
      }
      index = second.end + 1;
    } else if (first.value !== null) {
      values.add(first.value);
    }
  }

  return null;
}

function findGroupEnd(pattern: string, start: number): number | null {
  let depth = 0;
  for (let index = start; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      index = readRegexEscapeEnd(pattern, index);
      continue;
    }
    if (character === "[") {
      const characterClass = readCharacterClass(pattern, index);
      if (characterClass === null) return null;
      index = characterClass.end;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function parseSafetyBranch(branch: string): RegexSafetyToken[] | null {
  const tokens: RegexSafetyToken[] = [];
  for (let index = 0; index < branch.length; index += 1) {
    const character = branch[index];
    if (character === "\\") {
      const escaped = readSafetyEscape(branch, index);
      tokens.push(escaped.token);
      index = escaped.end;
      continue;
    }
    if (character === "[") {
      const characterClass = readCharacterClass(branch, index);
      if (characterClass === null) return null;
      tokens.push(characterClass.token);
      index = characterClass.end;
      continue;
    }
    if (character === "(") {
      const groupEnd = findGroupEnd(branch, index);
      if (groupEnd === null) return null;
      tokens.push({ characters: UNKNOWN_REGEX_CHARACTER_SET });
      index = groupEnd;
      continue;
    }
    if (character === "|" || character === "*" || character === "+" || character === "?" || character === "{") {
      return null;
    }
    if (character === ")" || character === "^" || character === "$" || character === ".") {
      tokens.push({ characters: UNKNOWN_REGEX_CHARACTER_SET });
      continue;
    }
    tokens.push({ characters: literalCharacterSet(character) });
  }
  return tokens;
}

function normalizeCharacterSet(values: Set<string>, caseInsensitive: boolean): Set<string> | null {
  const normalized = new Set<string>();
  for (const value of values) {
    if (caseInsensitive && /[^\x00-\x7f]/u.test(value)) return null;
    normalized.add(caseInsensitive ? value.toLowerCase() : value);
  }
  return normalized;
}

function areCharacterSetsDisjoint(left: RegexCharacterSet, right: RegexCharacterSet, caseInsensitive: boolean): boolean {
  if (left.kind === "unknown" || right.kind === "unknown") return false;
  const leftValues = left.kind === "exact" ? normalizeCharacterSet(left.values, caseInsensitive) : normalizeCharacterSet(left.excluded, caseInsensitive);
  const rightValues = right.kind === "exact" ? normalizeCharacterSet(right.values, caseInsensitive) : normalizeCharacterSet(right.excluded, caseInsensitive);
  if (leftValues === null || rightValues === null) return false;

  if (left.kind === "exact" && right.kind === "exact") {
    for (const value of leftValues) if (rightValues.has(value)) return false;
    return true;
  }
  if (left.kind === "exact" && right.kind === "negated") {
    for (const value of leftValues) if (!rightValues.has(value)) return false;
    return true;
  }
  if (left.kind === "negated" && right.kind === "exact") {
    for (const value of rightValues) if (!leftValues.has(value)) return false;
    return true;
  }
  return false;
}

function areBranchesProvablyDisjoint(left: RegexSafetyToken[], right: RegexSafetyToken[], caseInsensitive: boolean): boolean {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (areCharacterSetsDisjoint(left[index].characters, right[index].characters, caseInsensitive)) return true;
  }
  // Every aligned token overlaps, so one branch may be a prefix of the other
  // or both branches may consume the same text.
  return false;
}

function hasUnsafeQuantifiedAlternation(pattern: string, flags: string): boolean {
  const groups: RegexGroupScan[] = [];

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      index = readRegexEscapeEnd(pattern, index);
      continue;
    }
    if (character === "[") {
      const characterClass = readCharacterClass(pattern, index);
      if (characterClass === null) return false;
      index = characterClass.end;
      continue;
    }
    if (character === "(") {
      const contentStart = readGroupContentStart(pattern, index);
      groups.push({ containsQuantifier: false, contentStart, branchStarts: [contentStart], branchEnds: [] });
      index = contentStart - 1;
      continue;
    }
    if (character === "|" && groups.length > 0) {
      const group = groups[groups.length - 1];
      group.branchEnds.push(index);
      group.branchStarts.push(index + 1);
      continue;
    }
    if (character === ")" && groups.length > 0) {
      const group = groups.pop()!;
      const quantifierEnd = readQuantifierEnd(pattern, index + 1);
      if (quantifierEnd !== null && group.branchStarts.length > 1 && !group.containsQuantifier) {
        const branchEnds = [...group.branchEnds, index];
        const branches = group.branchStarts.map((start, branchIndex) => pattern.slice(start, branchEnds[branchIndex]));
        const parsedBranches = branches.map(parseSafetyBranch);
        for (let branchIndex = 0; branchIndex < parsedBranches.length; branchIndex += 1) {
          for (let otherIndex = branchIndex + 1; otherIndex < parsedBranches.length; otherIndex += 1) {
            const left = parsedBranches[branchIndex];
            const right = parsedBranches[otherIndex];
            if (left === null || right === null || !areBranchesProvablyDisjoint(left, right, flags.includes("i"))) return true;
          }
        }
      }

      if (groups.length > 0) {
        const parent = groups[groups.length - 1];
        parent.containsQuantifier ||= quantifierEnd !== null || group.containsQuantifier;
      }
      if (quantifierEnd !== null) index = quantifierEnd;
      continue;
    }

    const quantifierEnd = readQuantifierEnd(pattern, index);
    if (quantifierEnd !== null && groups.length > 0) {
      groups[groups.length - 1].containsQuantifier = true;
      index = quantifierEnd;
    }
  }

  return false;
}

export function validateRegexPattern(pattern: string, flags: string): string | null {
  if (pattern.length > REGEX_MAX_PATTERN_LENGTH) {
    return `Pattern is limited to ${REGEX_MAX_PATTERN_LENGTH} characters.`;
  }
  if (hasUnsafeNestedQuantifier(pattern)) {
    return "This pattern contains nested quantifiers that may cause catastrophic backtracking.";
  }
  if (hasUnsafeQuantifiedAlternation(pattern, flags)) {
    return "This pattern contains ambiguous alternatives inside a repetition that may cause catastrophic backtracking.";
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
