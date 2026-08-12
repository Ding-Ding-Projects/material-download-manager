export const PERSONAL_VOCABULARY_STORAGE_KEY = "personalVocabulary";
export const PERSONAL_VOCABULARY_SCHEMA = "material-download-manager-personal-vocabulary";
export const PERSONAL_VOCABULARY_VERSION = 1;
export const MAX_PERSONAL_VOCABULARY_BYTES = 64 * 1024;
export const MAX_PERSONAL_VOCABULARY_DEPTH = 4;
export const MAX_PERSONAL_VOCABULARY_ENTRIES = 256;
export const MAX_PERSONAL_VOCABULARY_KEY_LENGTH = 96;
export const MAX_PERSONAL_VOCABULARY_VALUE_LENGTH = 512;
export const PERSONAL_VOCABULARY_CLEAR_KEYS = Object.freeze(["CLEAR", "CACHE"]);

const EMPTY_REPLACEMENTS = Object.freeze(Object.create(null));
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// Only localizable prose is eligible. Preserve dynamic template placeholders,
// addresses, paths, commands, shortcuts, acronyms, and source-style names so a
// vocabulary mapping cannot rewrite a route, identifier, or factual value.
const BARE_COMMAND_SEGMENT = String.raw`\b(?:npm|npx|pnpm|yarn|node|git|gh|code|powershell|pwsh|cmd|python(?:3)?|py|curl|wget)(?:\s+(?:--?[A-Za-z0-9][A-Za-z0-9_.-]*(?:=[^\s,.;:]+)?|[A-Za-z0-9_./:@=+%-]+))*`;
const UNSAFE_MAPPING_CONTENT = new RegExp(String.raw`\{\{\w+\}\}|(?:https?|chrome):\/\/[^\s<]+|\x60[^\x60]*\x60|\b(?:Ctrl|Alt|Shift|Meta)\+(?:[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*)\b|\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS)\s+\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+|(?:[A-Za-z]:\\|\\\\)[^\s<]+|\b[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\b|\b[A-Z][a-z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+\b|${BARE_COMMAND_SEGMENT}`, "u");
const PROTECTED_TEXT_SEGMENTS = new RegExp(String.raw`\{\{\w+\}\}|(?:https?|chrome):\/\/[^\s<]+|\x60[^\x60]*\x60|\b(?:Ctrl|Alt|Shift|Meta)\+(?:[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*)\b|\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS)\s+\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+|(?:[A-Za-z]:\\|\\\\)[^\s<]+|\b[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\b|\b[A-Z][a-z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+\b|${BARE_COMMAND_SEGMENT}`, "gu");
const STANDALONE_TECHNICAL_TOKEN = /^(?:[A-Z]{2,}[A-Z0-9_-]*|[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+)$/u;

export class PersonalVocabularyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PersonalVocabularyError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PersonalVocabularyError(code, message);
}

function isRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function validateBoundedText(value, maximum, code) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(code, "The selected JSON file contains an unsupported replacement value.");
  }
  return value;
}

function strictJsonParse(raw) {
  if (typeof raw !== "string") fail("personal-vocabulary-not-text", "Choose a local JSON file.");
  if (byteLength(raw) > MAX_PERSONAL_VOCABULARY_BYTES) {
    fail("personal-vocabulary-too-large", `The selected JSON file must be ${MAX_PERSONAL_VOCABULARY_BYTES} bytes or smaller.`);
  }

  let position = 0;
  const whitespace = /[\u0020\u000a\u000d\u0009]/u;

  function skipWhitespace() {
    while (position < raw.length && whitespace.test(raw[position])) position += 1;
  }

  function parseString() {
    if (raw[position] !== '"') fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
    position += 1;
    let value = "";
    while (position < raw.length) {
      const character = raw[position];
      position += 1;
      if (character === '"') return value;
      if (character === "\\") {
        if (position >= raw.length) fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
        const escaped = raw[position];
        position += 1;
        const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (own(simple, escaped)) {
          value += simple[escaped];
          continue;
        }
        if (escaped === "u") {
          const hexadecimal = raw.slice(position, position + 4);
          if (!/^[0-9a-fA-F]{4}$/u.test(hexadecimal)) fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
          value += String.fromCharCode(Number.parseInt(hexadecimal, 16));
          position += 4;
          continue;
        }
        fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
      }
      if (character.charCodeAt(0) < 0x20) fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
      value += character;
    }
    fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
  }

  function parseNumber() {
    const start = position;
    if (raw[position] === "-") position += 1;
    if (raw[position] === "0") {
      position += 1;
    } else if (/[1-9]/u.test(raw[position] ?? "")) {
      while (/[0-9]/u.test(raw[position] ?? "")) position += 1;
    } else {
      fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
    }
    if (raw[position] === ".") {
      position += 1;
      if (!/[0-9]/u.test(raw[position] ?? "")) fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
      while (/[0-9]/u.test(raw[position] ?? "")) position += 1;
    }
    if (raw[position] === "e" || raw[position] === "E") {
      position += 1;
      if (raw[position] === "+" || raw[position] === "-") position += 1;
      if (!/[0-9]/u.test(raw[position] ?? "")) fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
      while (/[0-9]/u.test(raw[position] ?? "")) position += 1;
    }
    const value = Number(raw.slice(start, position));
    if (!Number.isFinite(value)) fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
    return value;
  }

  function parseArray(depth) {
    const value = [];
    position += 1;
    skipWhitespace();
    if (raw[position] === "]") {
      position += 1;
      return value;
    }
    while (position < raw.length) {
      value.push(parseValue(depth + 1));
      skipWhitespace();
      if (raw[position] === "]") {
        position += 1;
        return value;
      }
      if (raw[position] !== ",") fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
      position += 1;
      skipWhitespace();
    }
    fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
  }

  function parseObject(depth) {
    const value = Object.create(null);
    const keys = new Set();
    position += 1;
    skipWhitespace();
    if (raw[position] === "}") {
      position += 1;
      return value;
    }
    while (position < raw.length) {
      skipWhitespace();
      const key = parseString();
      if (UNSAFE_KEYS.has(key)) fail("personal-vocabulary-unsafe-key", "The selected JSON file contains an unsafe key.");
      if (keys.has(key)) fail("personal-vocabulary-duplicate-key", "The selected JSON file contains a duplicate key.");
      keys.add(key);
      skipWhitespace();
      if (raw[position] !== ":") fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
      position += 1;
      value[key] = parseValue(depth + 1);
      skipWhitespace();
      if (raw[position] === "}") {
        position += 1;
        return value;
      }
      if (raw[position] !== ",") fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
      position += 1;
      skipWhitespace();
    }
    fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
  }

  function parseValue(depth) {
    if (depth > MAX_PERSONAL_VOCABULARY_DEPTH) fail("personal-vocabulary-too-deep", "The selected JSON file is nested too deeply.");
    skipWhitespace();
    const current = raw[position];
    if (current === '"') return parseString();
    if (current === "{") return parseObject(depth);
    if (current === "[") return parseArray(depth);
    if (current === "t" && raw.slice(position, position + 4) === "true") {
      position += 4;
      return true;
    }
    if (current === "f" && raw.slice(position, position + 5) === "false") {
      position += 5;
      return false;
    }
    if (current === "n" && raw.slice(position, position + 4) === "null") {
      position += 4;
      return null;
    }
    if (current === "-" || /[0-9]/u.test(current ?? "")) return parseNumber();
    fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
  }

  const value = parseValue(0);
  skipWhitespace();
  if (position !== raw.length) fail("personal-vocabulary-invalid-json", "The selected file is not valid JSON.");
  return value;
}

function validatedReplacements(value) {
  if (!isRecord(value)) fail("personal-vocabulary-invalid-replacements", "The selected JSON file must contain a replacement object.");
  const entries = Object.entries(value);
  if (entries.length > MAX_PERSONAL_VOCABULARY_ENTRIES) {
    fail("personal-vocabulary-too-many-entries", `The selected JSON file can contain at most ${MAX_PERSONAL_VOCABULARY_ENTRIES} replacements.`);
  }
  const replacements = Object.create(null);
  for (const [key, replacement] of entries) {
    if (UNSAFE_KEYS.has(key)) fail("personal-vocabulary-unsafe-key", "The selected JSON file contains an unsafe key.");
    validateBoundedText(key, MAX_PERSONAL_VOCABULARY_KEY_LENGTH, "personal-vocabulary-invalid-key");
    validateBoundedText(replacement, MAX_PERSONAL_VOCABULARY_VALUE_LENGTH, "personal-vocabulary-invalid-value");
    if (UNSAFE_MAPPING_CONTENT.test(key) || STANDALONE_TECHNICAL_TOKEN.test(key)) {
      fail("personal-vocabulary-unsafe-key", "The selected JSON file contains a command, identifier, or other protected key.");
    }
    replacements[key] = replacement;
  }
  return Object.freeze(replacements);
}

function validatePayload(value) {
  if (!isRecord(value)) fail("personal-vocabulary-invalid-root", "The selected JSON file must contain one object.");
  const expected = ["schema", "version", "replacements"];
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some((key) => !own(value, key)) || keys.some((key) => !expected.includes(key))) {
    fail("personal-vocabulary-unexpected-field", "The selected JSON file has unsupported fields.");
  }
  if (value.schema !== PERSONAL_VOCABULARY_SCHEMA || value.version !== PERSONAL_VOCABULARY_VERSION) {
    fail("personal-vocabulary-unsupported-version", "This JSON file uses an unsupported personal-vocabulary version.");
  }
  return Object.freeze({
    schema: PERSONAL_VOCABULARY_SCHEMA,
    version: PERSONAL_VOCABULARY_VERSION,
    replacements: validatedReplacements(value.replacements),
  });
}

export function validatePersonalVocabularyText(raw) {
  return validatePayload(strictJsonParse(raw));
}

export function validatePersonalVocabularyCache(value) {
  const validated = validatePayload(value);
  if (byteLength(JSON.stringify(validated)) > MAX_PERSONAL_VOCABULARY_BYTES) {
    fail("personal-vocabulary-cache-too-large", "The saved local vocabulary cache exceeds the supported size.");
  }
  return validated;
}

export function decodePersonalVocabularyUtf8(bytes) {
  const view = bytes instanceof Uint8Array
    ? bytes
    : bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : null;
  if (!view) fail("personal-vocabulary-not-bytes", "Choose a local JSON file.");
  if (view.byteLength > MAX_PERSONAL_VOCABULARY_BYTES) {
    fail("personal-vocabulary-too-large", `The selected JSON file must be ${MAX_PERSONAL_VOCABULARY_BYTES} bytes or smaller.`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    fail("personal-vocabulary-invalid-utf8", "The selected file must be valid UTF-8 JSON.");
  }
}

export async function readPersonalVocabulary(storage) {
  const stored = await storage.get(PERSONAL_VOCABULARY_STORAGE_KEY);
  const cached = stored?.[PERSONAL_VOCABULARY_STORAGE_KEY];
  if (cached === undefined || cached === null) {
    return { status: "empty", replacements: EMPTY_REPLACEMENTS };
  }
  try {
    return { status: "loaded", replacements: validatePersonalVocabularyCache(cached).replacements };
  } catch {
    return { status: "invalid", replacements: EMPTY_REPLACEMENTS };
  }
}

export async function importPersonalVocabulary(storage, raw) {
  const validated = validatePersonalVocabularyText(raw);
  await storage.set({ [PERSONAL_VOCABULARY_STORAGE_KEY]: validated });
  return { status: "loaded", replacements: validated.replacements };
}

export async function clearPersonalVocabulary(storage) {
  if (typeof storage.remove === "function") {
    await storage.remove(PERSONAL_VOCABULARY_STORAGE_KEY);
  } else {
    await storage.set({ [PERSONAL_VOCABULARY_STORAGE_KEY]: null });
  }
  return { status: "empty" };
}

export function canConfirmPersonalVocabularyClear(keyOne, keyTwo, sliderValue) {
  return String(keyOne ?? "").trim().toUpperCase() === PERSONAL_VOCABULARY_CLEAR_KEYS[0]
    && String(keyTwo ?? "").trim().toUpperCase() === PERSONAL_VOCABULARY_CLEAR_KEYS[1]
    && Number(sliderValue) === 100;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function validReplacementEntries(replacements) {
  if (!isRecord(replacements)) return [];
  return Object.entries(replacements)
    .filter(([key, value]) => typeof key === "string" && typeof value === "string" && key.length > 0 && key.length <= MAX_PERSONAL_VOCABULARY_KEY_LENGTH && value.length > 0 && value.length <= MAX_PERSONAL_VOCABULARY_VALUE_LENGTH && !UNSAFE_KEYS.has(key) && !UNSAFE_MAPPING_CONTENT.test(key) && !STANDALONE_TECHNICAL_TOKEN.test(key))
    .sort(([left], [right]) => right.length - left.length || left.localeCompare(right));
}

function replaceVisibleSegment(value, matcher, replacements) {
  return value.replace(matcher, (matched) => replacements[matched]);
}

export function applyPersonalVocabulary(text, replacements) {
  if (typeof text !== "string") return text;
  const entries = validReplacementEntries(replacements);
  if (entries.length === 0) return text;
  const mapping = Object.create(null);
  entries.forEach(([key, value]) => { mapping[key] = value; });
  const matcher = new RegExp(entries.map(([key]) => escapeRegex(key)).join("|"), "gu");
  let result = "";
  let offset = 0;
  for (const protectedMatch of text.matchAll(PROTECTED_TEXT_SEGMENTS)) {
    result += replaceVisibleSegment(text.slice(offset, protectedMatch.index), matcher, mapping);
    result += protectedMatch[0];
    offset = (protectedMatch.index ?? 0) + protectedMatch[0].length;
  }
  result += replaceVisibleSegment(text.slice(offset), matcher, mapping);
  return result;
}

export function presentationPersonalVocabulary(settings, replacements) {
  return settings?.schoolModeEnabled === true ? EMPTY_REPLACEMENTS : replacements;
}
