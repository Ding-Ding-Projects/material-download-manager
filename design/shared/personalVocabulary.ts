/**
 * Local-only personal wording contract.
 *
 * This module deliberately contains only a neutral schema and bounded parser.
 * Actual user-selected mappings are runtime data held in private application
 * storage and never belong in application settings, exports, history, logs,
 * or the renderer bundle.
 */

export const PERSONAL_VOCABULARY_SCHEMA_VERSION = 1 as const;
export const PERSONAL_VOCABULARY_MAX_BYTES = 64 * 1024;
export const PERSONAL_VOCABULARY_MAX_DEPTH = 4;
export const PERSONAL_VOCABULARY_MAX_ENTRIES = 128;
export const PERSONAL_VOCABULARY_MAX_KEY_LENGTH = 128;
export const PERSONAL_VOCABULARY_MAX_VALUE_LENGTH = 256;
export const PERSONAL_VOCABULARY_MAX_RENDERED_TEXT_LENGTH = 32 * 1024;

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type PersonalVocabularyState = "no-file" | "loaded" | "invalid";

export interface PersonalVocabularyReplacement {
  from: string;
  to: string;
}

/** Status contains no selected filename, path, or replacement text. */
export interface PersonalVocabularyStatus {
  schemaVersion: 1;
  state: PersonalVocabularyState;
  entryCount: number;
}

/**
 * This is a runtime-only IPC shape. It is never embedded in AppSettings or a
 * state snapshot. The renderer retains it only long enough to render private
 * user-facing copy on this device.
 */
export interface PersonalVocabularyRuntime {
  status: PersonalVocabularyStatus;
  replacements: PersonalVocabularyReplacement[];
}

interface JsonObject {
  [key: string]: JsonValue;
}

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

/**
 * Personal wording applies to prose only. Keep command-shaped phrases, URLs,
 * paths, and common tool identifiers out of the mapping contract before they
 * can reach the renderer copy boundary.
 */
function hasProtectedTechnicalSyntax(value: string): boolean {
  if (/[`]/u.test(value) || /(?:^|\s)(?:https?:\/\/|www\.)/iu.test(value)) return true;
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value)) return true;
  return /(?:^|\s)(?:git|gh|npm|npx|node|pnpm|yarn|pwsh|powershell|cmd|python|py|cargo|docker)(?:\s|$)/iu.test(value);
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string"
    && (allowEmpty || value.length > 0)
    && value.length <= maximum
    && !hasControlCharacter(value);
}

class StrictJsonParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): JsonValue {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.input.length) throw new Error("Personal vocabulary JSON has trailing content");
    return value;
  }

  private parseValue(depth: number): JsonValue {
    if (depth > PERSONAL_VOCABULARY_MAX_DEPTH) {
      throw new Error("Personal vocabulary JSON exceeds the maximum nesting depth");
    }
    this.skipWhitespace();
    const current = this.input[this.index];
    if (current === "{") return this.parseObject(depth + 1);
    if (current === "[") return this.parseArray(depth + 1);
    if (current === '"') return this.parseString();
    if (current === "t") return this.parseLiteral("true", true);
    if (current === "f") return this.parseLiteral("false", false);
    if (current === "n") return this.parseLiteral("null", null);
    if (current === "-" || (current !== undefined && /\d/u.test(current))) return this.parseNumber();
    throw new Error("Personal vocabulary JSON contains an invalid value");
  }

  private parseObject(depth: number): JsonObject {
    this.expect("{");
    this.skipWhitespace();
    const output = Object.create(null) as JsonObject;
    const keys = new Set<string>();
    if (this.consume("}")) return output;

    while (true) {
      this.skipWhitespace();
      if (this.input[this.index] !== '"') throw new Error("Personal vocabulary JSON object keys must be strings");
      const key = this.parseString();
      if (UNSAFE_OBJECT_KEYS.has(key)) throw new Error("Personal vocabulary JSON contains an unsafe object key");
      if (keys.has(key)) throw new Error("Personal vocabulary JSON contains a duplicate object key");
      keys.add(key);
      this.skipWhitespace();
      this.expect(":");
      output[key] = this.parseValue(depth);
      this.skipWhitespace();
      if (this.consume("}")) return output;
      this.expect(",");
    }
  }

  private parseArray(depth: number): JsonValue[] {
    this.expect("[");
    this.skipWhitespace();
    const output: JsonValue[] = [];
    if (this.consume("]")) return output;
    while (true) {
      output.push(this.parseValue(depth));
      this.skipWhitespace();
      if (this.consume("]")) return output;
      this.expect(",");
    }
  }

  private parseString(): string {
    const start = this.index;
    this.expect('"');
    let escaped = false;
    while (this.index < this.input.length) {
      const current = this.input[this.index];
      if (current === undefined || current.charCodeAt(0) < 0x20) {
        throw new Error("Personal vocabulary JSON contains an invalid string");
      }
      this.index += 1;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === "\\") {
        escaped = true;
        continue;
      }
      if (current === '"') {
        const token = this.input.slice(start, this.index);
        try {
          return JSON.parse(token) as string;
        } catch {
          throw new Error("Personal vocabulary JSON contains an invalid string escape");
        }
      }
    }
    throw new Error("Personal vocabulary JSON contains an unterminated string");
  }

  private parseNumber(): number {
    const remaining = this.input.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(remaining);
    if (!match) throw new Error("Personal vocabulary JSON contains an invalid number");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new Error("Personal vocabulary JSON contains a non-finite number");
    return value;
  }

  private parseLiteral<T extends boolean | null>(literal: string, value: T): T {
    if (!this.input.startsWith(literal, this.index)) throw new Error("Personal vocabulary JSON contains an invalid literal");
    this.index += literal.length;
    return value;
  }

  private skipWhitespace(): void {
    while (this.index < this.input.length && /[\t\n\r ]/u.test(this.input[this.index] ?? "")) this.index += 1;
  }

  private consume(expected: string): boolean {
    if (this.input.startsWith(expected, this.index)) {
      this.index += expected.length;
      return true;
    }
    return false;
  }

  private expect(expected: string): void {
    if (!this.consume(expected)) throw new Error("Personal vocabulary JSON has invalid punctuation");
  }
}

function parseStrictJson(input: string): JsonValue {
  return new StrictJsonParser(input).parse();
}

function cloneReplacement(value: PersonalVocabularyReplacement): PersonalVocabularyReplacement {
  return { from: value.from, to: value.to };
}

export function createPersonalVocabularyRuntime(
  state: PersonalVocabularyState = "no-file",
  replacements: readonly PersonalVocabularyReplacement[] = [],
): PersonalVocabularyRuntime {
  const cloned = replacements.map(cloneReplacement);
  return {
    status: {
      schemaVersion: PERSONAL_VOCABULARY_SCHEMA_VERSION,
      state,
      entryCount: cloned.length,
    },
    replacements: cloned,
  };
}

/** Parse and validate the only supported local JSON payload shape. */
export function parsePersonalVocabularyPayload(input: string): PersonalVocabularyReplacement[] {
  if (new TextEncoder().encode(input).byteLength > PERSONAL_VOCABULARY_MAX_BYTES) {
    throw new Error("Personal vocabulary JSON exceeds the maximum file size");
  }
  const raw = parseStrictJson(input);
  if (!isJsonObject(raw)) throw new Error("Personal vocabulary JSON must be an object");
  const keys = Object.keys(raw);
  if (keys.length !== 2 || !keys.includes("schemaVersion") || !keys.includes("replacements")) {
    throw new Error("Personal vocabulary JSON has unsupported fields");
  }
  if (raw.schemaVersion !== PERSONAL_VOCABULARY_SCHEMA_VERSION) {
    throw new Error("Personal vocabulary JSON has an unsupported schema version");
  }
  if (!isJsonObject(raw.replacements)) throw new Error("Personal vocabulary JSON replacements must be an object");
  const entries = Object.entries(raw.replacements);
  if (entries.length > PERSONAL_VOCABULARY_MAX_ENTRIES) {
    throw new Error("Personal vocabulary JSON has too many replacements");
  }
  const replacements: PersonalVocabularyReplacement[] = [];
  for (const [from, to] of entries) {
    if (UNSAFE_OBJECT_KEYS.has(from) || !boundedText(from, PERSONAL_VOCABULARY_MAX_KEY_LENGTH) || hasProtectedTechnicalSyntax(from)) {
      throw new Error("Personal vocabulary JSON has an invalid replacement key");
    }
    if (!boundedText(to, PERSONAL_VOCABULARY_MAX_VALUE_LENGTH, true)) {
      throw new Error("Personal vocabulary JSON has an invalid replacement value");
    }
    replacements.push({ from, to });
  }
  return replacements;
}

export function isPersonalVocabularyRuntime(value: unknown): value is PersonalVocabularyRuntime {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 2 || !("status" in candidate) || !("replacements" in candidate)) return false;
  const status = candidate.status;
  if (typeof status !== "object" || status === null || Array.isArray(status)) return false;
  const statusRecord = status as Record<string, unknown>;
  if (
    Object.keys(statusRecord).length !== 3
    || statusRecord.schemaVersion !== PERSONAL_VOCABULARY_SCHEMA_VERSION
    || (statusRecord.state !== "no-file" && statusRecord.state !== "loaded" && statusRecord.state !== "invalid")
    || !Number.isInteger(statusRecord.entryCount)
    || (typeof statusRecord.entryCount === "number" && (statusRecord.entryCount < 0 || statusRecord.entryCount > PERSONAL_VOCABULARY_MAX_ENTRIES))
    || !Array.isArray(candidate.replacements)
    || candidate.replacements.length > PERSONAL_VOCABULARY_MAX_ENTRIES
  ) {
    return false;
  }
  const replacements = candidate.replacements;
  if (!replacements.every((replacement) => {
    if (typeof replacement !== "object" || replacement === null || Array.isArray(replacement)) return false;
    const record = replacement as Record<string, unknown>;
    return Object.keys(record).length === 2
      && boundedText(record.from, PERSONAL_VOCABULARY_MAX_KEY_LENGTH)
      && boundedText(record.to, PERSONAL_VOCABULARY_MAX_VALUE_LENGTH, true)
      && !UNSAFE_OBJECT_KEYS.has(record.from as string)
      && !hasProtectedTechnicalSyntax(record.from as string);
  })) return false;
  if (new Set(replacements.map((replacement) => (replacement as PersonalVocabularyReplacement).from)).size !== replacements.length) return false;
  if (statusRecord.state === "no-file" && replacements.length !== 0) return false;
  return statusRecord.entryCount === replacements.length;
}

function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Applies a bounded, single-pass literal transformation to application copy.
 * Callers opt in at the user-facing copy boundary; identifiers, paths, URLs,
 * raw records, and command syntax deliberately do not call this function.
 */
export function applyPersonalVocabularyText(
  source: string,
  runtime: PersonalVocabularyRuntime | null | undefined,
  options: { suppressed?: boolean } = {},
): string {
  if (options.suppressed || !runtime || !isPersonalVocabularyRuntime(runtime) || runtime.replacements.length === 0) return source;
  const ordered = [...runtime.replacements].sort((left, right) => right.from.length - left.from.length || left.from.localeCompare(right.from));
  const lookup = new Map(ordered.map((replacement) => [replacement.from, replacement.to]));
  const expression = new RegExp(ordered.map((replacement) => escapeLiteral(replacement.from)).join("|"), "gu");
  let result = "";
  let cursor = 0;
  for (let match = expression.exec(source); match; match = expression.exec(source)) {
    const replacement = lookup.get(match[0]);
    const next = `${result}${source.slice(cursor, match.index)}${replacement ?? match[0]}`;
    if (next.length > PERSONAL_VOCABULARY_MAX_RENDERED_TEXT_LENGTH) return source;
    result = next;
    cursor = match.index + match[0].length;
  }
  const complete = `${result}${source.slice(cursor)}`;
  return complete.length <= PERSONAL_VOCABULARY_MAX_RENDERED_TEXT_LENGTH ? complete : source;
}
