(function (global) {
  "use strict";

  // This neutral, local-only contract intentionally contains no vocabulary
  // terms, mappings, example files, source paths, or telemetry hooks.
  const SCHEMA_VERSION = 1;
  const MAX_BYTES = 65_536;
  const MAX_DEPTH = 3;
  const MAX_NODES = 1_024;
  const MAX_ENTRIES = 128;
  const MAX_KEY_BYTES = 96;
  const MAX_VALUE_BYTES = 384;
  const MAX_RENDERED_TEXT_BYTES = 32_768;
  const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const ROOT_FIELDS = new Set(["schemaVersion", "replacements"]);
  const CONTROL_OR_DIRECTIONAL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/;

  function createFailure(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(String(value));
  }

  function utf8Length(value) {
    return utf8Bytes(value).byteLength;
  }

  function hasUnpairedSurrogate(value) {
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = text.charCodeAt(index + 1);
        if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
        index += 1;
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        return true;
      }
    }
    return false;
  }

  function isSafeString(value, maxBytes, allowEmpty) {
    return typeof value === "string"
      && (allowEmpty || value.length > 0)
      && !CONTROL_OR_DIRECTIONAL.test(value)
      && !hasUnpairedSurrogate(value)
      && utf8Length(value) <= maxBytes;
  }

  function isPlainRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function parseStrictJson(text) {
    if (typeof text !== "string" || utf8Length(text) > MAX_BYTES || hasUnpairedSurrogate(text)) throw createFailure("invalid-json");
    let index = 0;
    let nodeCount = 0;

    function skipWhitespace() {
      while (index < text.length && /[\u0020\u000A\u000D\u0009]/.test(text[index])) index += 1;
    }

    function expect(character) {
      if (text[index] !== character) throw createFailure("invalid-json");
      index += 1;
    }

    function parseString() {
      const start = index;
      expect('"');
      while (index < text.length) {
        const character = text[index];
        const code = text.charCodeAt(index);
        if (character === '"') {
          index += 1;
          try {
            return JSON.parse(text.slice(start, index));
          } catch (_error) {
            throw createFailure("invalid-json");
          }
        }
        if (code < 0x20) throw createFailure("invalid-json");
        if (character === "\\") {
          index += 1;
          const escaped = text[index];
          if (!escaped) throw createFailure("invalid-json");
          if (escaped === "u") {
            const hex = text.slice(index + 1, index + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw createFailure("invalid-json");
            index += 5;
            continue;
          }
          if (!'"\\/bfnrt'.includes(escaped)) throw createFailure("invalid-json");
          index += 1;
          continue;
        }
        index += 1;
      }
      throw createFailure("invalid-json");
    }

    function parseNumber() {
      const match = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!match) throw createFailure("invalid-json");
      index += match[0].length;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw createFailure("invalid-json");
      return value;
    }

    function parseLiteral(literal, value) {
      if (!text.startsWith(literal, index)) throw createFailure("invalid-json");
      index += literal.length;
      return value;
    }

    function parseArray(depth) {
      expect("[");
      skipWhitespace();
      const values = [];
      if (text[index] === "]") {
        index += 1;
        return values;
      }
      while (true) {
        values.push(parseValue(depth + 1));
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return values;
        }
        expect(",");
        skipWhitespace();
      }
    }

    function parseObject(depth) {
      expect("{");
      skipWhitespace();
      const result = Object.create(null);
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return result;
      }
      while (true) {
        if (text[index] !== '"') throw createFailure("invalid-json");
        const key = parseString();
        if (keys.has(key)) throw createFailure("duplicate-key");
        if (UNSAFE_KEYS.has(key)) throw createFailure("unsafe-key");
        keys.add(key);
        skipWhitespace();
        expect(":");
        skipWhitespace();
        result[key] = parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return result;
        }
        expect(",");
        skipWhitespace();
      }
    }

    function parseValue(depth) {
      if (depth > MAX_DEPTH) throw createFailure("nesting-limit");
      nodeCount += 1;
      if (nodeCount > MAX_NODES) throw createFailure("node-limit");
      skipWhitespace();
      const character = text[index];
      if (character === '"') return parseString();
      if (character === "{") return parseObject(depth);
      if (character === "[") return parseArray(depth);
      if (character === "t") return parseLiteral("true", true);
      if (character === "f") return parseLiteral("false", false);
      if (character === "n") return parseLiteral("null", null);
      return parseNumber();
    }

    skipWhitespace();
    const value = parseValue(0);
    skipWhitespace();
    if (index !== text.length) throw createFailure("invalid-json");
    return value;
  }

  function validateRecord(candidate) {
    if (!isPlainRecord(candidate)) return { ok: false, code: "invalid-root" };
    const rootKeys = Object.keys(candidate);
    if (rootKeys.length !== ROOT_FIELDS.size || rootKeys.some((key) => !ROOT_FIELDS.has(key))) return { ok: false, code: "unexpected-field" };
    if (!Number.isSafeInteger(candidate.schemaVersion) || candidate.schemaVersion !== SCHEMA_VERSION) return { ok: false, code: "unsupported-version" };
    if (!isPlainRecord(candidate.replacements)) return { ok: false, code: "invalid-replacements" };
    const entries = Object.entries(candidate.replacements);
    if (entries.length > MAX_ENTRIES) return { ok: false, code: "entry-limit" };
    const replacements = Object.create(null);
    for (const [source, replacement] of entries) {
      if (UNSAFE_KEYS.has(source)) return { ok: false, code: "unsafe-key" };
      if (!isSafeString(source, MAX_KEY_BYTES, false)) return { ok: false, code: "invalid-key" };
      if (!isSafeString(replacement, MAX_VALUE_BYTES, true)) return { ok: false, code: "invalid-value" };
      replacements[source] = replacement;
    }
    return {
      ok: true,
      record: Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        replacements: Object.freeze(replacements)
      })
    };
  }

  function validateTextPayload(text) {
    try {
      return validateRecord(parseStrictJson(text));
    } catch (error) {
      return { ok: false, code: error?.code || "invalid-json" };
    }
  }

  function validateBytePayload(value) {
    try {
      const bytes = value instanceof Uint8Array
        ? value
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : null;
      if (!bytes || bytes.byteLength > MAX_BYTES) return { ok: false, code: "byte-limit" };
      if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return { ok: false, code: "invalid-json" };
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      return validateTextPayload(text);
    } catch (_error) {
      return { ok: false, code: "invalid-utf8" };
    }
  }

  function emptyRecord() {
    return Object.freeze({ schemaVersion: SCHEMA_VERSION, replacements: Object.freeze(Object.create(null)) });
  }

  function serializeRecord(record) {
    const validated = validateRecord(record);
    if (!validated.ok) throw createFailure(validated.code);
    return JSON.stringify(validated.record);
  }

  function applyReplacements(value, record) {
    const original = String(value ?? "");
    const validated = validateRecord(record);
    if (!validated.ok || !Object.keys(validated.record.replacements).length) return original;
    let rendered = original;
    for (const [source, replacement] of Object.entries(validated.record.replacements)) {
      if (!rendered.includes(source)) continue;
      const next = rendered.split(source).join(replacement);
      if (utf8Length(next) > MAX_RENDERED_TEXT_BYTES) return original;
      rendered = next;
    }
    return rendered;
  }

  global.MDM_SITE_PERSONAL_VOCABULARY_CONTRACT = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    limits: Object.freeze({
      maxBytes: MAX_BYTES,
      maxDepth: MAX_DEPTH,
      maxNodes: MAX_NODES,
      maxEntries: MAX_ENTRIES,
      maxKeyBytes: MAX_KEY_BYTES,
      maxValueBytes: MAX_VALUE_BYTES,
      maxRenderedTextBytes: MAX_RENDERED_TEXT_BYTES
    }),
    emptyRecord,
    validateRecord,
    validateTextPayload,
    validateBytePayload,
    serializeRecord,
    applyReplacements
  });
})(typeof window === "object" ? window : globalThis);
