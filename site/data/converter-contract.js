(function (global) {
  "use strict";

  const MAX_INPUT_BYTES = 32 * 1024 * 1024;
  const MAX_OUTPUT_BYTES = 40 * 1024 * 1024;
  const MAX_SNIFF_BYTES = 64 * 1024;
  const MAX_TEXT_PREVIEW_BYTES = 4 * 1024;
  const MAX_REGEX_LENGTH = 256;
  const MAX_REGEX_SAMPLE = 4096;
  const MAX_STRUCTURED_ROWS = 100_000;
  const MAX_STRUCTURED_CELLS = 250_000;
  const MAX_JSON_DEPTH = 64;
  const MAX_JSON_ITEMS = 250_000;
  const QUEUE_POLICY = Object.freeze({
    version: 1,
    maxConcurrentConversions: 2,
    maxInputBytes: MAX_INPUT_BYTES,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    maxSniffBytes: MAX_SNIFF_BYTES,
    maxPreviewBytes: MAX_TEXT_PREVIEW_BYTES,
    persistence: "IndexedDB metadata only; source File objects and generated Blobs are never persisted.",
    backpressure: "A bounded worker pump reads one bounded source at a time per worker and never preloads every file byte."
  });

  const CATEGORIES = Object.freeze([
    "Documents/PDF",
    "Images",
    "Audio",
    "Video",
    "Archives",
    "Structured Data/Spreadsheets",
    "Code/Text",
    "Binary Encodings"
  ]);

  const BROWSER_PDF_LIMITATION = "Unavailable: this static browser build does not bundle an offline PDF parser/writer. It will not upload a document, call a remote converter, or rely on a device-installed tool.";
  const BROWSER_AUDIO_LIMITATION = "Unavailable: this static browser build has no bundled offline audio decoder and encoder pair. Browser playback support is not proof of a safe local conversion path.";
  const BROWSER_VIDEO_LIMITATION = "Unavailable: this static browser build has no bundled offline video demuxer or encoder. It will not use a server, command line, or browser recording fallback.";
  const BROWSER_ARCHIVE_LIMITATION = "Unavailable: this static browser build has no bundled archive reader/writer. ZIP file detection remains available, but extraction and creation are not claimed.";
  const BROWSER_WORKBOOK_LIMITATION = "Unavailable: this static browser build has no bundled XLSX/ODS workbook parser. CSV and JSON routes remain separate browser-local adapters.";

  const ADAPTERS = Object.freeze([
    { id: "pdf-inspect", category: "Documents/PDF", label: "Inspect PDF", sourceKinds: ["pdf"], target: { extension: "pdf", mime: "application/pdf" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No PDF parser/writer is bundled.", reason: BROWSER_PDF_LIMITATION, lossiness: "None; unavailable." },
    { id: "pdf-split", category: "Documents/PDF", label: "Split PDF pages", sourceKinds: ["pdf"], target: { extension: "pdf", mime: "application/pdf" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No PDF parser/writer is bundled.", reason: BROWSER_PDF_LIMITATION, lossiness: "None; unavailable." },
    { id: "pdf-merge", category: "Documents/PDF", label: "Merge PDF files", sourceKinds: ["pdf"], target: { extension: "pdf", mime: "application/pdf" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No PDF parser/writer is bundled.", reason: BROWSER_PDF_LIMITATION, lossiness: "None; unavailable." },
    { id: "pdf-extract", category: "Documents/PDF", label: "Extract PDF pages", sourceKinds: ["pdf"], target: { extension: "pdf", mime: "application/pdf" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No PDF parser/writer is bundled.", reason: BROWSER_PDF_LIMITATION, lossiness: "None; unavailable." },
    { id: "pdf-reorder", category: "Documents/PDF", label: "Reorder or rotate PDF pages", sourceKinds: ["pdf"], target: { extension: "pdf", mime: "application/pdf" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No PDF parser/writer is bundled.", reason: BROWSER_PDF_LIMITATION, lossiness: "None; unavailable." },
    { id: "pdf-metadata", category: "Documents/PDF", label: "Edit PDF metadata", sourceKinds: ["pdf"], target: { extension: "pdf", mime: "application/pdf" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No PDF parser/writer is bundled.", reason: BROWSER_PDF_LIMITATION, lossiness: "None; unavailable." },

    { id: "image-to-png", category: "Images", label: "Image → PNG", sourceKinds: ["png", "jpeg"], target: { extension: "png", mime: "image/png" }, enabled: true, bundled: true, platformBuiltIn: true, browserLocal: true, packageProof: "Browser Canvas 2D and ImageBitmap are the verified built-in adapter after a bundled PNG/JPEG dimension preflight; no script, codec package, PATH lookup, or network request is used.", reason: "", conversion: "canvas", lossiness: "Re-rasterizes the image and drops original metadata, color profile metadata, and animation. Transparent pixels are preserved when the input decoder supplies alpha." },
    { id: "image-to-jpeg", category: "Images", label: "Image → JPEG", sourceKinds: ["png", "jpeg"], target: { extension: "jpg", mime: "image/jpeg" }, enabled: true, bundled: true, platformBuiltIn: true, browserLocal: true, packageProof: "Browser Canvas 2D and ImageBitmap are the verified built-in adapter after a bundled PNG/JPEG dimension preflight; no script, codec package, PATH lookup, or network request is used.", reason: "", conversion: "canvas", lossiness: "Lossy re-encoding. Transparency is flattened against white; metadata, color profile metadata, and animation are dropped." },
    { id: "image-to-webp", category: "Images", label: "Image → WebP", sourceKinds: ["png", "jpeg"], target: { extension: "webp", mime: "image/webp" }, enabled: true, bundled: true, platformBuiltIn: true, browserLocal: true, packageProof: "Browser Canvas 2D and ImageBitmap are the verified built-in adapter after a bundled PNG/JPEG dimension preflight. The output type and decoder round-trip are checked before a result is offered.", reason: "", conversion: "canvas", lossiness: "Re-rasterizes the image; browser WebP support is checked after encoding. Metadata, color profile metadata, and animation are dropped." },
    { id: "gif-image-conversion", category: "Images", label: "GIF image conversion", sourceKinds: ["gif"], target: { extension: "png", mime: "image/png" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No bundled animation-aware image decoder is present.", reason: "Unavailable: GIF can be animated. This site refuses to silently keep only a first frame without a bundled animation-aware adapter.", lossiness: "Animation would be lost." },
    { id: "webp-image-input", category: "Images", label: "WebP image input conversion", sourceKinds: ["webp"], target: { extension: "png", mime: "image/png" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No bundled WebP dimension preflight is present.", reason: "Unavailable: this static browser build does not decode arbitrary WebP input before a bundled dimension preflight can prove its resource bounds. It will not guess from a MIME type or send the image elsewhere.", lossiness: "Unavailable." },

    { id: "audio-transcode", category: "Audio", label: "Audio transcode", sourceKinds: ["audio"], target: { extension: "wav", mime: "audio/wav" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No audio encoder is bundled.", reason: BROWSER_AUDIO_LIMITATION, lossiness: "Unavailable." },
    { id: "audio-metadata", category: "Audio", label: "Audio metadata editor", sourceKinds: ["audio"], target: { extension: "audio", mime: "application/octet-stream" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No audio metadata adapter is bundled.", reason: BROWSER_AUDIO_LIMITATION, lossiness: "Unavailable." },

    { id: "video-transcode", category: "Video", label: "Video transcode", sourceKinds: ["video"], target: { extension: "mp4", mime: "video/mp4" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No video encoder is bundled.", reason: BROWSER_VIDEO_LIMITATION, lossiness: "Unavailable." },
    { id: "video-extract-audio", category: "Video", label: "Extract video audio", sourceKinds: ["video"], target: { extension: "audio", mime: "application/octet-stream" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No demuxer is bundled.", reason: BROWSER_VIDEO_LIMITATION, lossiness: "Unavailable." },

    { id: "archive-inspect", category: "Archives", label: "Inspect archive", sourceKinds: ["zip", "gzip"], target: { extension: "archive", mime: "application/octet-stream" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No archive reader/writer is bundled.", reason: BROWSER_ARCHIVE_LIMITATION, lossiness: "Unavailable." },
    { id: "archive-create", category: "Archives", label: "Create ZIP or 7z archive", sourceKinds: ["binary", "text"], target: { extension: "zip", mime: "application/zip" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No ZIP or 7z writer is bundled.", reason: BROWSER_ARCHIVE_LIMITATION, lossiness: "Unavailable." },

    { id: "csv-to-json", category: "Structured Data/Spreadsheets", label: "CSV → JSON", sourceKinds: ["csv"], target: { extension: "json", mime: "application/json" }, enabled: true, bundled: true, platformBuiltIn: true, browserLocal: true, packageProof: "The bounded CSV parser is shipped in this local browser bundle; no workbook library or external service is used.", reason: "", conversion: "text", lossiness: "Header names become object keys. Repeated headers are disambiguated locally; formatting, formulas, comments, and workbook features do not exist in CSV." },
    { id: "json-to-csv", category: "Structured Data/Spreadsheets", label: "JSON array → CSV", sourceKinds: ["json", "json-candidate"], target: { extension: "csv", mime: "text/csv;charset=utf-8" }, enabled: true, bundled: true, platformBuiltIn: true, browserLocal: true, packageProof: "The bounded JSON/CSV serializer is shipped in this local browser bundle; no workbook library or external service is used.", reason: "", conversion: "text", lossiness: "Only a top-level array of plain objects is accepted. Nested values are serialized as JSON text; type and formatting information can change." },
    { id: "workbook-conversion", category: "Structured Data/Spreadsheets", label: "XLSX or ODS workbook conversion", sourceKinds: ["xlsx", "ods"], target: { extension: "csv", mime: "text/csv" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No workbook parser is bundled.", reason: BROWSER_WORKBOOK_LIMITATION, lossiness: "Unavailable." },

    { id: "text-normalize", category: "Code/Text", label: "UTF-8 text → normalized UTF-8 text", sourceKinds: ["text", "csv", "json", "base64-text"], target: { extension: "txt", mime: "text/plain;charset=utf-8" }, enabled: true, bundled: true, platformBuiltIn: true, browserLocal: true, packageProof: "TextDecoder, TextEncoder, and the normalizer are part of the local browser bundle; no network or system tool is used.", reason: "", conversion: "text", lossiness: "Line endings are normalized to LF. Input must be valid UTF-8; original encoding metadata is not retained." },
    { id: "json-format", category: "Code/Text", label: "JSON → formatted JSON", sourceKinds: ["json", "json-candidate"], target: { extension: "json", mime: "application/json" }, enabled: true, bundled: true, platformBuiltIn: true, browserLocal: true, packageProof: "The bounded JSON parser and formatter are shipped in this local browser bundle.", reason: "", conversion: "text", lossiness: "Whitespace and key formatting are rewritten; parsed JSON values are preserved." },
    { id: "code-formatting", category: "Code/Text", label: "Language-aware code formatting", sourceKinds: ["text"], target: { extension: "txt", mime: "text/plain" }, enabled: false, bundled: false, platformBuiltIn: false, browserLocal: false, packageProof: "No language formatter registry is bundled.", reason: "Unavailable: this static browser build does not bundle a language parser/formatter. It will not send source code to an online formatter.", lossiness: "Unavailable." },

    { id: "binary-to-base64", category: "Binary Encodings", label: "Binary → Base64 text", sourceKinds: ["binary", "png", "jpeg", "webp", "pdf", "zip", "gzip", "audio", "video"], target: { extension: "base64.txt", mime: "text/plain;charset=utf-8" }, enabled: true, bundled: true, platformBuiltIn: true, browserLocal: true, packageProof: "The bounded Base64 encoder is shipped in this local browser bundle; it does not call a device tool or service.", reason: "", conversion: "binary", lossiness: "The byte sequence is represented as Base64 text. The result is larger and has no original filename or MIME metadata." },
    { id: "base64-to-binary", category: "Binary Encodings", label: "Base64 text → binary", sourceKinds: ["base64-text"], target: { extension: "bin", mime: "application/octet-stream" }, enabled: true, bundled: true, platformBuiltIn: true, browserLocal: true, packageProof: "The bounded Base64 decoder is shipped in this local browser bundle; it does not call a device tool or service.", reason: "", conversion: "binary", lossiness: "The decoded byte sequence has no inferred filename or MIME type. Browser download naming is user-guided." }
  ]);

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function cleanText(value, maximum = 256) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }

  function safeFileName(value, fallback = "converted-file") {
    const normalized = cleanText(value, 180).replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "").replace(/\s+/g, " ");
    return normalized || fallback;
  }

  function extensionOf(value) {
    const name = safeFileName(value, "");
    const match = name.match(/\.([a-z0-9]{1,16})$/i);
    return match ? match[1].toLowerCase() : "";
  }

  function hasBytes(bytes, offset, expected) {
    if (bytes.length < offset + expected.length) return false;
    return expected.every((value, index) => bytes[offset + index] === value);
  }

  function decodeUtf8(bytes) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (_error) { return null; }
  }

  function looksLikeBase64(text, minimumLength = 4) {
    const compact = String(text ?? "").replace(/\s+/g, "");
    return compact.length >= minimumLength && compact.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(compact);
  }

  function inspectImageDimensions(bytes, kind) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (kind === "png" && source.length >= 24 && hasBytes(source, 12, [0x49, 0x48, 0x44, 0x52])) {
      return { width: ((source[16] << 24) >>> 0) + (source[17] << 16) + (source[18] << 8) + source[19], height: ((source[20] << 24) >>> 0) + (source[21] << 16) + (source[22] << 8) + source[23] };
    }
    if (kind !== "jpeg" || !hasBytes(source, 0, [0xff, 0xd8])) return null;
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < source.length) {
      while (source[offset] === 0xff) offset += 1;
      const marker = source[offset];
      offset += 1;
      if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 1 >= source.length) return null;
      const length = (source[offset] << 8) | source[offset + 1];
      if (length < 2 || offset + length > source.length) return null;
      if (sofMarkers.has(marker)) {
        if (length < 8) return null;
        return { width: (source[offset + 5] << 8) | source[offset + 6], height: (source[offset + 3] << 8) | source[offset + 4] };
      }
      offset += length;
    }
    return null;
  }

  function sniffBytes(value, fileName = "", mimeHint = "") {
    const bytes = value instanceof Uint8Array ? value.subarray(0, MAX_SNIFF_BYTES) : new Uint8Array(value || []).subarray(0, MAX_SNIFF_BYTES);
    const extension = extensionOf(fileName);
    const base = { bytesRead: bytes.length, extension, mimeHint: cleanText(mimeHint, 96), kind: "binary", label: "Unknown binary", mime: "application/octet-stream", text: null };
    if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ...base, kind: "png", label: "PNG image", mime: "image/png" };
    if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return { ...base, kind: "jpeg", label: "JPEG image", mime: "image/jpeg" };
    if (hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return { ...base, kind: "webp", label: "WebP image", mime: "image/webp" };
    if (hasBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38])) return { ...base, kind: "gif", label: "GIF image", mime: "image/gif" };
    if (hasBytes(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ...base, kind: "pdf", label: "PDF document", mime: "application/pdf" };
    if (hasBytes(bytes, 0, [0x50, 0x4b, 0x03, 0x04]) || hasBytes(bytes, 0, [0x50, 0x4b, 0x05, 0x06])) return { ...base, kind: extension === "xlsx" ? "xlsx" : extension === "ods" ? "ods" : "zip", label: extension === "xlsx" ? "XLSX workbook" : extension === "ods" ? "ODS workbook" : "ZIP archive", mime: "application/zip" };
    if (hasBytes(bytes, 0, [0x1f, 0x8b])) return { ...base, kind: "gzip", label: "Gzip archive", mime: "application/gzip" };
    if (hasBytes(bytes, 0, [0x4f, 0x67, 0x67, 0x53])) return { ...base, kind: "audio", label: "Ogg audio", mime: "audio/ogg" };
    if (hasBytes(bytes, 0, [0x49, 0x44, 0x33]) || hasBytes(bytes, 0, [0xff, 0xfb])) return { ...base, kind: "audio", label: "Audio file", mime: "audio/mpeg" };
    if (hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, 8, [0x57, 0x41, 0x56, 0x45])) return { ...base, kind: "audio", label: "WAV audio", mime: "audio/wav" };
    if (hasBytes(bytes, 4, [0x66, 0x74, 0x79, 0x70])) return { ...base, kind: "video", label: "ISO media file", mime: "video/mp4" };
    const decoded = decodeUtf8(bytes);
    if (decoded !== null) {
      const trimmed = decoded.trim();
      if (trimmed) {
        try { JSON.parse(trimmed); return { ...base, kind: "json", label: "JSON text", mime: "application/json", text: decoded }; } catch (_error) {
          if (bytes.length === MAX_SNIFF_BYTES && /^[\[{]/.test(trimmed)) return { ...base, kind: "json-candidate", label: "JSON-like UTF-8 text", mime: "application/json", text: null };
        }
        if (looksLikeBase64(trimmed, 8)) return { ...base, kind: "base64-text", label: "Base64 text", mime: "text/plain;charset=utf-8", text: decoded };
        if (extension === "csv" || /[\r\n]/.test(decoded) && /[,;\t]/.test(decoded.split(/\r?\n/, 1)[0] || "")) return { ...base, kind: "csv", label: "Delimited text", mime: "text/csv;charset=utf-8", text: decoded };
      }
      return { ...base, kind: "text", label: "UTF-8 text", mime: "text/plain;charset=utf-8", text: decoded };
    }
    return base;
  }

  function isSafeRegex(pattern, flags = "g") {
    const candidate = String(pattern ?? "");
    const normalizedFlags = String(flags ?? "").replace(/[^gimsuy]/g, "");
    if (candidate.length > MAX_REGEX_LENGTH) return "Pattern exceeds the local 256-character limit.";
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(candidate) || /\([^)]*\|[^)]*\)[+*{]/.test(candidate)) return "Pattern is rejected because nested or ambiguous quantifiers can stall a browser search.";
    try { new RegExp(candidate, normalizedFlags); return null; } catch (error) { return error instanceof Error ? error.message : "Invalid regular expression."; }
  }

  function adapterCanHandle(adapter, sniff) {
    return adapter.sourceKinds.includes(sniff?.kind) || adapter.sourceKinds.includes("*");
  }

  function validateRegistry(registry = ADAPTERS) {
    assert(Array.isArray(registry) && registry.length >= CATEGORIES.length, "Adapter registry must be a non-empty hand-written catalog.");
    const ids = new Set();
    const categoryCoverage = new Set();
    for (const adapter of registry) {
      assert(typeof adapter.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(adapter.id), `Invalid adapter id: ${adapter?.id}`);
      assert(!ids.has(adapter.id), `Duplicate adapter id: ${adapter.id}`);
      ids.add(adapter.id);
      assert(CATEGORIES.includes(adapter.category), `Adapter ${adapter.id} has an unknown category.`);
      categoryCoverage.add(adapter.category);
      assert(Array.isArray(adapter.sourceKinds) && adapter.sourceKinds.length > 0, `Adapter ${adapter.id} must declare source kinds.`);
      assert(typeof adapter.target?.extension === "string" && /^[a-z0-9.]{1,16}$/i.test(adapter.target.extension), `Adapter ${adapter.id} must declare a safe target extension.`);
      assert(typeof adapter.target?.mime === "string" && adapter.target.mime.includes("/"), `Adapter ${adapter.id} must declare a target MIME type.`);
      assert(typeof adapter.packageProof === "string" && adapter.packageProof.length > 12, `Adapter ${adapter.id} needs packaged-artifact proof.`);
      assert(typeof adapter.lossiness === "string" && adapter.lossiness.length > 4, `Adapter ${adapter.id} needs a lossiness disclosure.`);
      if (adapter.enabled) {
        assert(adapter.bundled === true, `Enabled adapter ${adapter.id} must be bundled=true.`);
        assert(adapter.browserLocal === true && adapter.platformBuiltIn === true, `Enabled adapter ${adapter.id} must use a local browser-proven adapter.`);
        assert(typeof adapter.conversion === "string" && adapter.conversion.length > 0, `Enabled adapter ${adapter.id} must declare its conversion boundary.`);
        assert(adapter.reason === "", `Enabled adapter ${adapter.id} cannot hide an unavailable reason.`);
      } else {
        assert(adapter.bundled === false && adapter.browserLocal === false, `Unavailable adapter ${adapter.id} cannot claim a bundled local route.`);
        assert(typeof adapter.reason === "string" && adapter.reason.startsWith("Unavailable:"), `Unavailable adapter ${adapter.id} needs an exact user-facing reason.`);
      }
    }
    for (const category of CATEGORIES) assert(categoryCoverage.has(category), `Required converter category is missing: ${category}`);
    const serialized = JSON.stringify(registry).toLowerCase();
    assert(!/(https?:|cloud api)/.test(serialized), "Adapter registry cannot claim a network converter.");
    return registry;
  }

  function validateQueuePolicy(policy = QUEUE_POLICY) {
    assert(policy && typeof policy === "object", "Queue policy must be an object.");
    assert(Number.isInteger(policy.maxConcurrentConversions) && policy.maxConcurrentConversions >= 1 && policy.maxConcurrentConversions <= 4, "Queue concurrency must be a small positive bound.");
    assert(Number.isInteger(policy.maxInputBytes) && policy.maxInputBytes > 0, "Queue input bound is required.");
    assert(Number.isInteger(policy.maxOutputBytes) && policy.maxOutputBytes >= policy.maxInputBytes, "Queue output bound is required.");
    assert(!("maxQueueItems" in policy) && !("totalFileLimit" in policy), "Queue policy cannot impose an artificial total-file cap.");
    assert(!/(load all|all bytes in memory)/i.test(String(policy.backpressure || "")), "Queue policy must not preload every source byte.");
    return policy;
  }

  function parseCsv(text) {
    const source = String(text ?? "");
    if (source.length > MAX_INPUT_BYTES) throw new Error("CSV text exceeds the local input bound.");
    const rows = [];
    let row = [], cell = "", quoted = false;
    let cellCount = 0;
    const commitCell = () => {
      if (cellCount >= MAX_STRUCTURED_CELLS) throw new Error("CSV exceeds the local structured-cell safety bound.");
      row.push(cell);
      cellCount += 1;
      cell = "";
    };
    const commitRow = () => {
      commitCell();
      if (rows.length >= MAX_STRUCTURED_ROWS) throw new Error("CSV exceeds the local structured-row safety bound.");
      rows.push(row);
      row = [];
    };
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") commitCell();
      else if (char === "\n") commitRow();
      else if (char !== "\r") cell += char;
    }
    if (quoted) throw new Error("CSV has an unterminated quoted cell.");
    if (cell.length || row.length) commitRow();
    if (!rows.length) throw new Error("CSV has no rows to convert.");
    const rawHeaders = rows.shift().map((value, index) => cleanText(value, 120) || `column_${index + 1}`);
    const seen = new Map();
    const headers = rawHeaders.map((value) => { const count = (seen.get(value) || 0) + 1; seen.set(value, count); return count === 1 ? value : `${value}_${count}`; });
    return rows.filter((row) => row.some((value) => value !== "")).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  }

  function csvCell(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toCsv(value) {
    if (!Array.isArray(value) || !value.every((row) => row && typeof row === "object" && !Array.isArray(row))) throw new Error("JSON → CSV requires a top-level array of plain objects.");
    if (value.length > MAX_STRUCTURED_ROWS) throw new Error("JSON → CSV exceeds the local structured-row safety bound.");
    const headerSet = new Set();
    let cellCount = 0;
    for (const row of value) {
      for (const key of Object.keys(row)) {
        headerSet.add(key);
        cellCount += 1;
        if (cellCount > MAX_STRUCTURED_CELLS) throw new Error("JSON → CSV exceeds the local structured-cell safety bound.");
      }
    }
    const headers = [...headerSet];
    if (!headers.length) throw new Error("JSON → CSV requires at least one object field.");
    return [headers.map(csvCell).join(","), ...value.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(","))].join("\n") + "\n";
  }

  function bytesToBase64(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const expectedBytes = Math.ceil(source.length / 3) * 4;
    if (expectedBytes > MAX_OUTPUT_BYTES) throw new Error("Base64 output would exceed the local result bound.");
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < source.length; index += chunk) binary += String.fromCharCode(...source.subarray(index, Math.min(source.length, index + chunk)));
    return btoa(binary);
  }

  function base64ToBytes(text) {
    const compact = String(text ?? "").replace(/\s+/g, "");
    if (!looksLikeBase64(compact, 4)) throw new Error("The selected text is not valid padded Base64.");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if (compact.endsWith("==") && (alphabet.indexOf(compact.at(-3)) & 0x0f) !== 0) throw new Error("The selected Base64 has non-canonical pad bits.");
    if (compact.endsWith("=") && !compact.endsWith("==") && (alphabet.indexOf(compact.at(-2)) & 0x03) !== 0) throw new Error("The selected Base64 has non-canonical pad bits.");
    const expectedBytes = (compact.length / 4) * 3 - (compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0);
    if (expectedBytes > MAX_OUTPUT_BYTES) throw new Error("Decoded Base64 would exceed the local result bound.");
    const binary = atob(compact);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
    return output;
  }

  function inspectJsonValue(value, depth = 0, budget = { items: 0 }) {
    if (depth > MAX_JSON_DEPTH) throw new Error("JSON exceeds the local nesting-depth safety bound.");
    if (!value || typeof value !== "object") return value;
    for (const key of Object.keys(value)) {
      budget.items += 1;
      if (budget.items > MAX_JSON_ITEMS) throw new Error("JSON exceeds the local item-count safety bound.");
      inspectJsonValue(value[key], depth + 1, budget);
    }
    return value;
  }

  function transform(adapterId, source) {
    const adapter = ADAPTERS.find((item) => item.id === adapterId);
    if (!adapter?.enabled) throw new Error("This adapter is unavailable in the local browser build.");
    if (adapter.conversion === "canvas") throw new Error("Canvas image conversions use the browser image adapter, not the text transform.");
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source || []);
    if (bytes.length > MAX_INPUT_BYTES) throw new Error("Source exceeds the local conversion input bound.");
    const textResult = (value) => {
      const text = String(value ?? "");
      if (new TextEncoder().encode(text).byteLength > MAX_OUTPUT_BYTES) throw new Error("Converted text exceeds the local result bound.");
      return { kind: "text", text, mime: adapter.target.mime, extension: adapter.target.extension };
    };
    if (adapterId === "binary-to-base64") return textResult(bytesToBase64(bytes));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (adapterId === "base64-to-binary") return { kind: "bytes", bytes: base64ToBytes(text), mime: adapter.target.mime, extension: adapter.target.extension };
    if (adapterId === "text-normalize") return textResult(text.replace(/\r\n?/g, "\n"));
    if (adapterId === "json-format") { const value = inspectJsonValue(JSON.parse(text)); return textResult(`${JSON.stringify(value, null, 2)}\n`); }
    if (adapterId === "csv-to-json") return textResult(`${JSON.stringify(parseCsv(text), null, 2)}\n`);
    if (adapterId === "json-to-csv") { const value = inspectJsonValue(JSON.parse(text)); return textResult(toCsv(value)); }
    throw new Error(`No local transform is registered for ${adapterId}.`);
  }

  function validateOutput(adapter, bytes) {
    const output = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!adapter?.enabled) return false;
    if (!output.length || output.length > MAX_OUTPUT_BYTES) return false;
    const sniff = sniffBytes(output, `converted.${adapter.target.extension}`, adapter.target.mime);
    if (adapter.target.mime === "application/json") {
      const text = decodeUtf8(output);
      if (text === null) return false;
      try { JSON.parse(text); return true; } catch (_error) { return false; }
    }
    if (adapter.target.mime.startsWith("text/")) {
      const text = decodeUtf8(output);
      if (text === null) return false;
      if (adapter.id === "binary-to-base64") { try { base64ToBytes(text); return true; } catch (_error) { return false; } }
      return sniff.kind === "text" || sniff.kind === "csv" || sniff.kind === "base64-text";
    }
    if (adapter.target.mime === "application/octet-stream") return true;
    return sniff.mime === adapter.target.mime;
  }

  function makeTargetName(sourceName, adapter, requestedName = "") {
    const extension = adapter?.target?.extension || "bin";
    const fallbackBase = safeFileName(sourceName, "converted-file").replace(/\.[^.]+$/, "") || "converted-file";
    const requested = safeFileName(requestedName, "");
    const base = requested ? requested.replace(/\.[^.]+$/, "") : fallbackBase;
    return `${base}.${extension}`;
  }

  validateRegistry();
  validateQueuePolicy();

  global.MDM_SITE_CONVERTER_CONTRACT = Object.freeze({
    version: 1,
    categories: CATEGORIES,
    adapters: ADAPTERS,
    queuePolicy: QUEUE_POLICY,
    MAX_INPUT_BYTES,
    MAX_OUTPUT_BYTES,
    MAX_SNIFF_BYTES,
    MAX_TEXT_PREVIEW_BYTES,
    MAX_REGEX_LENGTH,
    MAX_REGEX_SAMPLE,
    MAX_STRUCTURED_ROWS,
    MAX_STRUCTURED_CELLS,
    MAX_JSON_DEPTH,
    MAX_JSON_ITEMS,
    cleanText,
    safeFileName,
    extensionOf,
    sniffBytes,
    inspectImageDimensions,
    isSafeRegex,
    adapterCanHandle,
    validateRegistry,
    validateQueuePolicy,
    parseCsv,
    toCsv,
    bytesToBase64,
    base64ToBytes,
    inspectJsonValue,
    transform,
    validateOutput,
    makeTargetName
  });
})(window);
