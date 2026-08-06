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

export interface ExportResult {
  content: string;
  extension: string;
  mimeType: string;
  warnings: string[];
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

function asRecords(value: unknown): RecordValue[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => (item && typeof item === "object" && !Array.isArray(item) ? item as RecordValue : { value: item }));
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "";
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "";
}

function quoteCsv(value: string, separator: string): string {
  return /["\r\n]/.test(value) || value.includes(separator) ? "\"" + value.replace(/"/g, "\"\"") + "\"" : value;
}

function columns(records: RecordValue[]): string[] {
  const keys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return keys.length > 0 ? keys : ["value"];
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  return /^[A-Za-z0-9_.-]+$/.test(text) ? text : JSON.stringify(text);
}

function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object") return pad + "-\n" + toYaml(item, indent + 2);
      return pad + "- " + yamlScalar(item);
    }).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as RecordValue).map(([key, item]) => {
      if (item && typeof item === "object") return pad + key + ":\n" + toYaml(item, indent + 2);
      return pad + key + ": " + yamlScalar(item);
    }).join("\n");
  }
  return pad + yamlScalar(value);
}

function xmlName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(normalized) ? normalized : "field_" + normalized;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toXmlValue(key: string, value: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  const name = xmlName(key);
  if (Array.isArray(value)) return value.map((item) => toXmlValue(name, item, indent)).join("\n");
  if (value && typeof value === "object") {
    const body = Object.entries(value as RecordValue).map(([child, item]) => toXmlValue(child, item, indent + 2)).join("\n");
    return pad + "<" + name + ">\n" + body + "\n" + pad + "</" + name + ">";
  }
  return pad + "<" + name + ">" + xmlEscape(scalar(value)) + "</" + name + ">";
}

function toSqlValue(value: unknown): string {
  return "'" + scalar(value).replace(/'/g, "''") + "'";
}

function codeLiteral(format: ExportFormat, records: RecordValue[]): string {
  const payload = json(records);
  switch (format) {
    case "javascript": return "export const records = " + payload + ";\n";
    case "typescript": return "export const records: ReadonlyArray<Record<string, unknown>> = " + payload + ";\n";
    case "python": return "records = " + payload.replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None") + "\n";
    case "go": return "package exported\n\nvar RecordsJSON = " + JSON.stringify(payload) + "\n";
    case "rust": return "pub const RECORDS_JSON: &str = r#" + JSON.stringify(payload) + "#;\n";
    default: return payload;
  }
}

export function exportRecords(value: unknown, format: ExportFormat): ExportResult {
  const records = asRecords(value);
  const meta = FORMAT_META[format];
  const warnings: string[] = [];
  let content: string;

  switch (format) {
    case "json": content = json(records) + "\n"; break;
    case "jsonl": content = records.map((record) => JSON.stringify(record)).join("\n") + "\n"; break;
    case "yaml": content = toYaml(records) + "\n"; break;
    case "toml": content = records.map((record) => "[[records]]\n" + Object.entries(record).map(([key, item]) => key + " = " + JSON.stringify(scalar(item))).join("\n")).join("\n\n") + "\n"; break;
    case "xml": content = "<records>\n" + records.map((record) => toXmlValue("record", record, 2)).join("\n") + "\n</records>\n"; break;
    case "csv":
    case "tsv": {
      const separator = format === "csv" ? "," : "\t";
      const keys = columns(records);
      content = [keys.map((key) => quoteCsv(key, separator)).join(separator), ...records.map((record) => keys.map((key) => quoteCsv(scalar(record[key]), separator)).join(separator))].join("\n") + "\n";
      if (records.some((record) => Object.values(record).some((item) => item && typeof item === "object"))) warnings.push("Nested values are encoded as JSON strings in tabular output.");
      break;
    }
    case "markdown": {
      const keys = columns(records);
      content = ["| " + keys.join(" | ") + " |", "| " + keys.map(() => "---").join(" | ") + " |", ...records.map((record) => "| " + keys.map((key) => scalar(record[key]).replace(/\|/g, "\\|").replace(/\r?\n/g, " ")).join(" | ") + " |")].join("\n") + "\n";
      warnings.push("Markdown tables preserve scalar fields; nested values are rendered as JSON text.");
      break;
    }
    case "html": {
      const keys = columns(records);
      content = "<table>\n  <thead><tr>" + keys.map((key) => "<th>" + xmlEscape(key) + "</th>").join("") + "</tr></thead>\n  <tbody>\n" + records.map((record) => "    <tr>" + keys.map((key) => "<td>" + xmlEscape(scalar(record[key])) + "</td>").join("") + "</tr>").join("\n") + "\n  </tbody>\n</table>\n";
      warnings.push("HTML output is a standalone table without scripts or external assets.");
      break;
    }
    case "sql": {
      const keys = columns(records);
      const quotedKeys = keys.map((key) => "\"" + key.replace(/"/g, "\"\"") + "\"").join(", ");
      content = "CREATE TABLE exported_records (" + keys.map((key) => "\"" + key.replace(/"/g, "\"\"") + "\" TEXT").join(", ") + ");\n";
      content += records.map((record) => "INSERT INTO exported_records (" + quotedKeys + ") VALUES (" + keys.map((key) => toSqlValue(record[key])).join(", ") + ");").join("\n") + "\n";
      warnings.push("SQL represents every field as TEXT and encodes nested values as JSON strings.");
      break;
    }
    case "javascript":
    case "typescript":
    case "python":
    case "go":
    case "rust": content = codeLiteral(format, records); break;
    case "json-schema": {
      const keys = columns(records);
      content = json({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "array", items: { type: "object", properties: Object.fromEntries(keys.map((key) => [key, {}])), additionalProperties: true } }) + "\n";
      warnings.push("The schema describes observed fields but cannot infer domain constraints from arbitrary records.");
      break;
    }
    case "protobuf":
      content = "syntax = \"proto3\";\n\nmessage ExportRecord {\n  string json = 1;\n}\n";
      warnings.push("Protobuf uses a JSON envelope because arbitrary records do not provide a stable protobuf schema; field-level typing is not preserved.");
      break;
  }

  return { content, ...meta, warnings };
}
