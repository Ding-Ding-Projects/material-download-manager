# Record export

## Behavior

The shared export serializer in design/shared/export.ts serializes owned
records to JSON, JSONL/NDJSON, YAML, TOML, XML, CSV, TSV, Markdown, HTML, SQL,
JavaScript, TypeScript, Python, Go, Rust, JSON Schema, and Protobuf. The
serializer is deterministic and keeps all fields in structured formats.
Tabular and presentation formats escape cells and return explicit warnings when
nested values are represented as JSON text.

## Configuration

The host chooses the format and supplies the records. A UI export surface must
show the format, UTF-8 encoding, line-ending behavior, and any warning before it
writes the file. Filtered views should pass the filtered records, not silently
export the whole collection.

## Failure modes and security

SQL values are quoted and escaped. XML/HTML output escapes markup; HTML is a
standalone table with no scripts or external assets. Protobuf receives a JSON
envelope when arbitrary records have no stable schema, and the warning says
that field-level typing is not preserved. Export code does not fetch remote
assets or log record contents.

## Verification

design/electron/__tests__/export.test.ts checks every supported format,
representational warnings, markup escaping, and SQL escaping. Run npm run build
and npm run test:electron from design/.

## Suggested articles

- Regex builder: ../search/regex-builder.md
- Tabbed navigation: ../navigation/tabbed-navigation.md
