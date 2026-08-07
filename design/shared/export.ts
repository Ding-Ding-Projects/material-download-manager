export type ExportFormat =
  | "json"
  | "jsonl"
  | "yaml"
  | "toml"
  | "xml"
  | "csv"
  | "tsv"
  | "markdown"
  | "html"
  | "sql"
  | "javascript"
  | "typescript"
  | "python"
  | "go"
  | "rust"
  | "json-schema"
  | "protobuf";

export const EXPORT_METADATA_SCHEMA = "material-download-manager.export" as const;
export const EXPORT_METADATA_VERSION = 1 as const;

export type ExportRoundTripStatus = "lossless" | "lossy" | "not-a-data-export";

export interface ExportRoundTripMetadata {
  status: ExportRoundTripStatus;
  canRoundTrip: boolean;
  lossless: boolean;
  method: "native-data" | "typed-envelope" | "json-text-fields" | "presentation" | "schema";
  preserved: string[];
  lost: string[];
}

export interface ExportMetadata {
  schema: typeof EXPORT_METADATA_SCHEMA;
  schemaVersion: typeof EXPORT_METADATA_VERSION;
  format: ExportFormat;
  encoding: "UTF-8";
  lineEnding: "LF";
  recordCount: number;
  roundTrip: ExportRoundTripMetadata;
}

export interface ExportResult {
  content: string;
  extension: string;
  mimeType: string;
  warnings: string[];
  /** Machine-readable facts for an import or UI to make a safe round-trip decision. */
  metadata: ExportMetadata;
  /** Convenience alias for callers that only need round-trip facts. */
  roundTrip: ExportRoundTripMetadata;
}

type RecordValue = Record<string, unknown>;

const FORMAT_META: Record<ExportFormat, Pick<ExportResult, "extension" | "mimeType">> = {
  json: { extension: "json", mimeType: "application/json" },
  jsonl: { extension: "jsonl", mimeType: "application/x-ndjson" },
  yaml: { extension: "yaml", mimeType: "application/yaml" },
  toml: { extension: "toml", mimeType: "application/toml" },
  xml: { extension: "xml", mimeType: "application/xml" },
  csv: { extension: "csv", mimeType: "text/csv" },
  tsv: { extension: "tsv", mimeType: "text/tab-separated-values" },
  markdown: { extension: "md", mimeType: "text/markdown" },
  html: { extension: "html", mimeType: "text/html" },
  sql: { extension: "sql", mimeType: "application/sql" },
  javascript: { extension: "js", mimeType: "text/javascript" },
  typescript: { extension: "ts", mimeType: "text/typescript" },
  python: { extension: "py", mimeType: "text/x-python" },
  go: { extension: "go", mimeType: "text/x-go" },
  rust: { extension: "rs", mimeType: "text/x-rust" },
  "json-schema": { extension: "schema.json", mimeType: "application/schema+json" },
  protobuf: { extension: "proto", mimeType: "text/plain" },
};

const EXPORT_FORMATS = Object.keys(FORMAT_META) as ExportFormat[];

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && EXPORT_FORMATS.includes(value as ExportFormat);
}

export function isExportResult(value: unknown): value is ExportResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const metadata = result.metadata;
  if (typeof result.content !== "string" || typeof result.extension !== "string" || result.extension.length > 64 ||
    typeof result.mimeType !== "string" || result.mimeType.length > 256 ||
    !Array.isArray(result.warnings) || result.warnings.length > 64 || result.warnings.some((warning) => typeof warning !== "string" || warning.length > 4_096) ||
    !metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
    !result.roundTrip || !isExportRoundTripMetadata(result.roundTrip)) return false;
  const meta = metadata as Record<string, unknown>;
  return meta.schema === EXPORT_METADATA_SCHEMA && meta.schemaVersion === EXPORT_METADATA_VERSION &&
    isExportFormat(meta.format) && meta.encoding === "UTF-8" && meta.lineEnding === "LF" &&
    typeof meta.recordCount === "number" && Number.isInteger(meta.recordCount) && meta.recordCount >= 0 &&
    isExportRoundTripMetadata(meta.roundTrip);
}

function isExportRoundTripMetadata(value: unknown): value is ExportRoundTripMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const roundTrip = value as Record<string, unknown>;
  const methods = ["native-data", "typed-envelope", "json-text-fields", "presentation", "schema"];
  const statuses = ["lossless", "lossy", "not-a-data-export"];
  return statuses.includes(roundTrip.status as string) && typeof roundTrip.canRoundTrip === "boolean" &&
    typeof roundTrip.lossless === "boolean" && methods.includes(roundTrip.method as string) &&
    Array.isArray(roundTrip.preserved) && roundTrip.preserved.length <= 128 && roundTrip.preserved.every((item) => typeof item === "string" && item.length <= 256) &&
    Array.isArray(roundTrip.lost) && roundTrip.lost.length <= 128 && roundTrip.lost.every((item) => typeof item === "string" && item.length <= 256);
}

function asRecords(value: unknown): RecordValue[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => (
    item && typeof item === "object" && !Array.isArray(item)
      ? item as RecordValue
      : { value: item }
  ));
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return safeJson(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "null";
  }
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}

function quoteCsv(value: string, separator: string): string {
  return /["\r\n]/.test(value) || value.includes(separator)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function columns(records: RecordValue[]): string[] {
  const keys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return keys.length > 0 ? keys : ["value"];
}

function yamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(compactJson(value));
}

function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object") return `${pad}-\n${toYaml(item, indent + 2)}`;
      return `${pad}- ${yamlScalar(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as RecordValue).map(([key, item]) => {
      if (item && typeof item === "object") return `${pad}${yamlKey(key)}:\n${toYaml(item, indent + 2)}`;
      return `${pad}${yamlKey(key)}: ${yamlScalar(item)}`;
    }).join("\n");
  }
  return pad + yamlScalar(value);
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function isTomlScalar(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

function tomlScalar(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    return String(value);
  }
  return JSON.stringify(compactJson(value));
}

function tomlValue(value: unknown): { text: string; loss: string | null } {
  if (isTomlScalar(value)) {
    if (value === null) return { text: '""', loss: "TOML has no null scalar; null is encoded as an empty string." };
    return { text: tomlScalar(value), loss: null };
  }
  if (Array.isArray(value) && value.every((item) => isTomlScalar(item) && item !== null)) {
    return { text: `[${value.map((item) => tomlScalar(item)).join(", ")}]`, loss: null };
  }
  return {
    text: JSON.stringify(compactJson(value)),
    loss: "Nested, null, or unsupported TOML values are encoded as JSON strings.",
  };
}

function xmlName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(normalized) ? normalized : "field_" + normalized;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlType(value: unknown): "null" | "boolean" | "number" | "string" | "json" {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "string") return "string";
  return "json";
}

function xmlValue(value: unknown): string {
  const type = xmlType(value);
  if (type === "null") return "";
  if (type === "json") return xmlEscape(compactJson(value));
  return xmlEscape(String(value));
}

function toXmlRecord(record: RecordValue, index: number): string {
  const fields = Object.entries(record).map(([key, value]) => {
    const name = xmlName(key);
    const type = xmlType(value);
    return `    <field name="${xmlEscape(key)}" type="${type}" element="${name}">${xmlValue(value)}</field>`;
  });
  return `  <record index="${index}">\n${fields.join("\n")}\n  </record>`;
}

function sqlIdentifier(key: string): string {
  return `"${key.replace(/"/g, '""')}"`;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  return `'${scalar(value).replace(/'/g, "''")}'`;
}

function pythonLiteral(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as RecordValue).map(([key, item]) => `${JSON.stringify(key)}: ${pythonLiteral(item)}`).join(", ")}}`;
  }
  return "None";
}

function rustRawString(value: string): string {
  let hashes = "#";
  while (value.includes(`"${hashes}`)) hashes += "#";
  return `r${hashes}"${value}"${hashes}`;
}

interface InputLoss {
  path: string;
  reason: string;
}

function inspectJsonCompatibility(value: unknown, currentPath = "$", seen = new Set<object>()): InputLoss[] {
  if (value === undefined) return [{ path: currentPath, reason: "undefined values are omitted by JSON serializers" }];
  if (typeof value === "bigint") return [{ path: currentPath, reason: "bigint values are not representable in JSON" }];
  if (typeof value === "function" || typeof value === "symbol") {
    return [{ path: currentPath, reason: `${typeof value} values are not representable in JSON` }];
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return [{ path: currentPath, reason: "non-finite numbers become null in JSON" }];
  }
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [{ path: currentPath, reason: "circular references cannot be serialized" }];
  seen.add(value);
  const losses: InputLoss[] = [];
  if (value instanceof Date) losses.push({ path: currentPath, reason: "Date values become strings in JSON" });
  if (Array.isArray(value)) {
    value.forEach((item, index) => losses.push(...inspectJsonCompatibility(item, `${currentPath}[${index}]`, seen)));
  } else {
    Object.entries(value as RecordValue).forEach(([key, item]) => {
      losses.push(...inspectJsonCompatibility(item, `${currentPath}.${key}`, seen));
    });
  }
  seen.delete(value);
  return losses;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function lossWarning(reason: string): string {
  return `Loss warning: ${reason} This export is not fully round-trip safe.`;
}

function inputWarnings(losses: InputLoss[]): string[] {
  return losses.map(({ path, reason }) => lossWarning(`Input ${path}: ${reason}.`));
}

function finalize(
  format: ExportFormat,
  records: RecordValue[],
  content: string,
  warnings: string[],
  roundTrip: Omit<ExportRoundTripMetadata, "lossless" | "canRoundTrip" | "status"> & Partial<Pick<ExportRoundTripMetadata, "lossless" | "canRoundTrip" | "status">>,
): ExportResult {
  const normalizedWarnings = [...new Set(warnings)];
  const lossless = roundTrip.lossless ?? roundTrip.lost.length === 0;
  const canRoundTrip = roundTrip.canRoundTrip ?? (
    lossless && roundTrip.method !== "schema" && roundTrip.method !== "presentation"
  );
  const status = roundTrip.status ?? (lossless ? "lossless" : "lossy");
  const completeRoundTrip: ExportRoundTripMetadata = {
    ...roundTrip,
    status,
    canRoundTrip,
    lossless,
    preserved: [...new Set(roundTrip.preserved)],
    lost: [...new Set(roundTrip.lost)],
  };
  const metadata: ExportMetadata = {
    schema: EXPORT_METADATA_SCHEMA,
    schemaVersion: EXPORT_METADATA_VERSION,
    format,
    encoding: "UTF-8",
    lineEnding: "LF",
    recordCount: records.length,
    roundTrip: completeRoundTrip,
  };
  return {
    content,
    ...FORMAT_META[format],
    warnings: normalizedWarnings,
    metadata,
    roundTrip: completeRoundTrip,
  };
}

export function exportRecords(value: unknown, format: ExportFormat): ExportResult {
  if (!isExportFormat(format)) throw new Error("Unsupported export format");
  const records = asRecords(value);
  const compatibilityLosses = inspectJsonCompatibility(records);
  const warnings = inputWarnings(compatibilityLosses);
  const inputLost = compatibilityLosses.map(({ path, reason }) => `${path}: ${reason}`);
  const preserved = ["record count", "field names"];
  let content = "";
  let roundTrip: Omit<ExportRoundTripMetadata, "lossless" | "canRoundTrip" | "status"> & Partial<Pick<ExportRoundTripMetadata, "lossless" | "canRoundTrip" | "status">> = {
    method: "native-data",
    preserved,
    lost: inputLost,
  };

  switch (format) {
    case "json":
      content = safeJson(records) + "\n";
      break;
    case "jsonl":
      content = records.length > 0 ? records.map((record) => compactJson(record)).join("\n") + "\n" : "";
      break;
    case "yaml":
      content = toYaml(records) + "\n";
      break;
    case "toml": {
      const tomlLosses: string[] = [];
      content = records.map((record) => {
        const lines = ["[[records]]"];
        for (const [key, value] of Object.entries(record)) {
          const rendered = tomlValue(value);
          lines.push(`${tomlKey(key)} = ${rendered.text}`);
          if (rendered.loss) addUnique(tomlLosses, rendered.loss);
        }
        return lines.join("\n");
      }).join("\n\n") + (records.length > 0 ? "\n" : "");
      for (const loss of tomlLosses) {
        addUnique(roundTrip.lost, loss);
        warnings.push(lossWarning(loss));
      }
      if (tomlLosses.length > 0) roundTrip.method = "json-text-fields";
      break;
    }
    case "xml":
      content = `<?xml version="1.0" encoding="UTF-8"?>\n<records schema="${EXPORT_METADATA_SCHEMA}" schemaVersion="${EXPORT_METADATA_VERSION}">\n${records.map(toXmlRecord).join("\n")}\n</records>\n`;
      preserved.push("scalar types", "nested values as typed JSON fields");
      break;
    case "csv":
    case "tsv": {
      const separator = format === "csv" ? "," : "\t";
      const keys = columns(records);
      content = [
        keys.map((key) => quoteCsv(key, separator)).join(separator),
        ...records.map((record) => keys.map((key) => quoteCsv(scalar(record[key]), separator)).join(separator)),
      ].join("\n") + "\n";
      const loss = "tabular output stringifies numbers, booleans, and nulls; nested values are encoded as JSON strings.";
      roundTrip.method = "json-text-fields";
      addUnique(roundTrip.lost, loss);
      warnings.push(lossWarning(loss));
      break;
    }
    case "markdown": {
      const keys = columns(records);
      content = [
        `<!-- ${EXPORT_METADATA_SCHEMA} v${EXPORT_METADATA_VERSION}; ${records.length} records; presentation-only -->`,
        `| ${keys.join(" | ")} |`,
        `| ${keys.map(() => "---").join(" | ")} |`,
        ...records.map((record) => `| ${keys.map((key) => scalar(record[key]).replace(/\|/g, "\\|").replace(/\r?\n/g, " ")).join(" | ")} |`),
      ].join("\n") + "\n";
      roundTrip = {
        method: "presentation",
        preserved: ["record count", "displayed scalar text"],
        lost: ["nested structure", "exact scalar types", "unrendered metadata"],
        status: "lossy",
      };
      warnings.push(lossWarning("Markdown is a presentation table and cannot preserve nested structure or exact scalar types."));
      break;
    }
    case "html": {
      const keys = columns(records);
      content = `<table data-export-schema="${EXPORT_METADATA_SCHEMA}" data-export-version="${EXPORT_METADATA_VERSION}">\n  <thead><tr>${keys.map((key) => `<th>${xmlEscape(key)}</th>`).join("")}</tr></thead>\n  <tbody>\n${records.map((record) => `    <tr>${keys.map((key) => `<td>${xmlEscape(scalar(record[key]))}</td>`).join("")}</tr>`).join("\n")}\n  </tbody>\n</table>\n`;
      roundTrip = {
        method: "presentation",
        preserved: ["record count", "displayed scalar text"],
        lost: ["nested structure", "exact scalar types", "unrendered metadata"],
        status: "lossy",
      };
      warnings.push("HTML output is a standalone table without scripts or external assets.");
      warnings.push(lossWarning("HTML is presentation-only and cannot preserve nested structure or exact scalar types."));
      break;
    }
    case "sql": {
      const keys = columns(records);
      const quotedKeys = keys.map(sqlIdentifier).join(", ");
      content = `CREATE TABLE exported_records (${keys.map((key) => `${sqlIdentifier(key)} TEXT`).join(", ")});\n`;
      content += records.map((record) => `INSERT INTO exported_records (${quotedKeys}) VALUES (${keys.map((key) => sqlValue(record[key])).join(", ")});`).join("\n") + "\n";
      roundTrip.method = "json-text-fields";
      roundTrip.lost.push("SQL column types are TEXT", "nested values require JSON decoding");
      warnings.push(lossWarning("SQL represents every field as TEXT and encodes nested values as JSON strings."));
      break;
    }
    case "javascript":
      content = `// ${EXPORT_METADATA_SCHEMA} v${EXPORT_METADATA_VERSION}; ${records.length} records\nexport const records = ${safeJson(records)};\n`;
      break;
    case "typescript":
      content = `// ${EXPORT_METADATA_SCHEMA} v${EXPORT_METADATA_VERSION}; ${records.length} records\nexport const records: ReadonlyArray<Record<string, unknown>> = ${safeJson(records)};\n`;
      break;
    case "python":
      content = `# ${EXPORT_METADATA_SCHEMA} v${EXPORT_METADATA_VERSION}; ${records.length} records\nrecords = ${pythonLiteral(records)}\n`;
      break;
    case "go":
      content = `// ${EXPORT_METADATA_SCHEMA} v${EXPORT_METADATA_VERSION}; ${records.length} records\npackage exported\n\nvar RecordsJSON = ${JSON.stringify(compactJson(records))}\n`;
      roundTrip.method = "typed-envelope";
      preserved.push("JSON values inside RecordsJSON");
      warnings.push("Go output stores the records as a JSON envelope in RecordsJSON; consumers must decode that string.");
      break;
    case "rust":
      content = `// ${EXPORT_METADATA_SCHEMA} v${EXPORT_METADATA_VERSION}; ${records.length} records\npub const RECORDS_JSON: &str = ${rustRawString(compactJson(records))};\n`;
      roundTrip.method = "typed-envelope";
      preserved.push("JSON values inside RECORDS_JSON");
      warnings.push("Rust output stores the records as a JSON envelope in RECORDS_JSON; consumers must decode that string.");
      break;
    case "json-schema": {
      const keys = columns(records);
      content = safeJson({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "array",
        items: {
          type: "object",
          properties: Object.fromEntries(keys.map((key) => [key, {}])),
          additionalProperties: true,
        },
      }) + "\n";
      roundTrip = {
        method: "schema",
        preserved: ["observed field names"],
        lost: ["record values", "domain constraints not inferable from arbitrary records"],
        status: "not-a-data-export",
        canRoundTrip: false,
      };
      warnings.push("JSON Schema describes observed fields; it is not a record export and cannot round-trip the input values.");
      break;
    }
    case "protobuf":
      content = `syntax = "proto3";\n\n// ${EXPORT_METADATA_SCHEMA} v${EXPORT_METADATA_VERSION}\nmessage ExportRecord {\n  string json = 1;\n}\n`;
      roundTrip = {
        method: "schema",
        preserved: ["a JSON envelope field definition"],
        lost: ["field-level protobuf types", "record values until a consumer populates json"],
        status: "not-a-data-export",
        canRoundTrip: false,
      };
      warnings.push("Protobuf uses a JSON envelope because arbitrary records do not provide a stable protobuf schema; field-level typing is not preserved.");
      break;
  }

  return finalize(format, records, content, warnings, roundTrip);
}
