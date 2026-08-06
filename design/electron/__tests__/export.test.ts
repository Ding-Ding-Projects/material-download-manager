import test from "node:test";
import assert from "node:assert/strict";
import { exportRecords, type ExportFormat } from "../../shared/export";

const formats: ExportFormat[] = [
  "json", "jsonl", "yaml", "toml", "xml", "csv", "tsv", "markdown", "html", "sql",
  "javascript", "typescript", "python", "go", "rust", "json-schema", "protobuf",
];

test("exports records in every supported coding format", () => {
  const records = [{ id: 1, name: "A&B", nested: { ok: true } }, { id: 2, name: "Two" }];
  for (const format of formats) {
    const result = exportRecords(records, format);
    assert.ok(result.content.length > 0, format);
    assert.ok(result.extension.length > 0, format);
    assert.ok(result.mimeType.length > 0, format);
  }
});

test("tabular and schema exports state their representational limits", () => {
  const csv = exportRecords([{ id: 1, nested: { ok: true } }], "csv");
  assert.match(csv.content, /nested/);
  assert.ok(csv.warnings.some((warning) => /JSON strings/i.test(warning)));
  const schema = exportRecords([{ id: 1 }], "json-schema");
  assert.ok(schema.warnings.length > 0);
});

test("exports escape markup and SQL values", () => {
  assert.match(exportRecords([{ text: "<tag>" }], "xml").content, /&lt;tag&gt;/);
  assert.match(exportRecords([{ text: "O'Reilly" }], "sql").content, /O''Reilly/);
});
