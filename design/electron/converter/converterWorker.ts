import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { parentPort } from "node:worker_threads";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CONVERTER_MAX_INPUT_BYTES, CONVERTER_MAX_OUTPUT_BYTES } from "../../shared/converter";

type WorkerAdapterId = "structured-json-pretty" | "structured-json-to-csv" | "text-normalize-utf8" | "binary-to-base64" | "base64-to-binary";

interface WorkerRequest {
  kind: "convert";
  jobId: string;
  adapterId: WorkerAdapterId;
  sourcePath: string;
  temporaryOutputPath: string;
  inputBytes: number;
}

interface WorkerSuccess {
  kind: "complete";
  jobId: string;
  outputBytes: number;
}

const port = parentPort;
if (!port) throw new Error("Converter worker requires a parent port.");
const workerPort = port as NonNullable<typeof parentPort>;

function report(jobId: string, processedBytes: number): void {
  workerPort.postMessage({ kind: "progress", jobId, processedBytes });
}

function normalizeError(_error: unknown): string {
  // Source and destination paths are intentionally never returned through IPC.
  return "The local converter rejected the selected input or could not validate its output.";
}

async function ensureRegularBoundedFile(filePath: string, maximum: number): Promise<number> {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Source must be a regular file.");
  if (stat.size > maximum) throw new Error("Source is larger than this adapter permits.");
  return stat.size;
}

async function readBoundedUtf8(filePath: string, maximum = CONVERTER_MAX_INPUT_BYTES): Promise<string> {
  await ensureRegularBoundedFile(filePath, maximum);
  const bytes = await fsp.readFile(filePath);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return text.startsWith("\ufeff") ? text.slice(1) : text;
}

async function outputSize(filePath: string): Promise<number> {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > CONVERTER_MAX_OUTPUT_BYTES) {
    throw new Error("Output is not a bounded regular file.");
  }
  return stat.size;
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function parseFlatRecords(value: unknown): Array<Record<string, string | number | boolean | null>> {
  if (!Array.isArray(value) || value.length > 100_000) throw new Error("JSON-to-CSV requires a bounded top-level record array.");
  return value.map((row, rowIndex) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`JSON row ${rowIndex + 1} is not a flat record.`);
    const record: Record<string, string | number | boolean | null> = {};
    const entries = Object.entries(row as Record<string, unknown>);
    if (entries.length > 512) throw new Error("A JSON record contains too many fields.");
    for (const [key, entry] of entries) {
      if (key.length === 0 || key.length > 256 || !isPrimitive(entry)) throw new Error("JSON-to-CSV supports only bounded flat primitive fields.");
      if (typeof entry === "string" && entry.length > 16_384) throw new Error("A JSON field is too large for CSV conversion.");
      record[key] = entry;
    }
    return record;
  });
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}

function scalar(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

async function writeText(destination: string, text: string): Promise<void> {
  if (Buffer.byteLength(text, "utf8") > CONVERTER_MAX_OUTPUT_BYTES) throw new Error("Output exceeds the adapter limit.");
  await fsp.writeFile(destination, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      if (cell.length !== 0) throw new Error("Invalid CSV quote position.");
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Unterminated CSV quote.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function convertJsonPretty(request: WorkerRequest): Promise<number> {
  const text = await readBoundedUtf8(request.sourcePath);
  report(request.jobId, Buffer.byteLength(text, "utf8"));
  const parsed = JSON.parse(text) as unknown;
  const rendered = `${JSON.stringify(parsed, null, 2)}\n`;
  await writeText(request.temporaryOutputPath, rendered);
  const reopened = JSON.parse(await readBoundedUtf8(request.temporaryOutputPath, CONVERTER_MAX_OUTPUT_BYTES)) as unknown;
  if (JSON.stringify(reopened) !== JSON.stringify(parsed)) throw new Error("JSON output validation failed.");
  return outputSize(request.temporaryOutputPath);
}

async function convertJsonToCsv(request: WorkerRequest): Promise<number> {
  const text = await readBoundedUtf8(request.sourcePath);
  report(request.jobId, Buffer.byteLength(text, "utf8"));
  const records = parseFlatRecords(JSON.parse(text) as unknown);
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  if (headers.length === 0 || headers.length > 512) throw new Error("JSON-to-CSV needs one or more bounded record fields.");
  const rendered = [
    headers.map(csvCell).join(","),
    ...records.map((record) => headers.map((header) => csvCell(scalar(record[header]))).join(",")),
  ].join("\n") + "\n";
  await writeText(request.temporaryOutputPath, rendered);
  const reopened = parseCsv(await readBoundedUtf8(request.temporaryOutputPath, CONVERTER_MAX_OUTPUT_BYTES));
  if (reopened.length !== records.length + 1 || JSON.stringify(reopened[0]) !== JSON.stringify(headers)) {
    throw new Error("CSV output validation failed.");
  }
  return outputSize(request.temporaryOutputPath);
}

async function validateNormalizedText(filePath: string): Promise<void> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk as Uint8Array);
    total += bytes.length;
    if (total > CONVERTER_MAX_OUTPUT_BYTES) throw new Error("Text output exceeds the adapter limit.");
    if (bytes.includes(13)) throw new Error("Text output still contains a carriage return.");
    decoder.decode(bytes, { stream: true });
  }
  decoder.decode();
}

async function convertNormalizedText(request: WorkerRequest): Promise<number> {
  await ensureRegularBoundedFile(request.sourcePath, CONVERTER_MAX_INPUT_BYTES);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder();
  let pendingCarriageReturn = false;
  let processed = 0;
  const normalizer = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        processed += chunk.length;
        report(request.jobId, processed);
        let text = decoder.decode(chunk, { stream: true });
        if (pendingCarriageReturn) {
          text = `\r${text}`;
          pendingCarriageReturn = false;
        }
        if (text.endsWith("\r")) {
          pendingCarriageReturn = true;
          text = text.slice(0, -1);
        }
        callback(null, Buffer.from(encoder.encode(text.replace(/\r\n?/gu, "\n"))));
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        let text = decoder.decode();
        if (pendingCarriageReturn) text = `\r${text}`;
        callback(null, Buffer.from(encoder.encode(text.replace(/\r\n?/gu, "\n"))));
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  await pipeline(createReadStream(request.sourcePath), normalizer, createWriteStream(request.temporaryOutputPath, { flags: "wx", mode: 0o600 }));
  await validateNormalizedText(request.temporaryOutputPath);
  return outputSize(request.temporaryOutputPath);
}

async function convertBinaryToBase64(request: WorkerRequest): Promise<number> {
  await ensureRegularBoundedFile(request.sourcePath, CONVERTER_MAX_INPUT_BYTES);
  const sourceHash = createHash("sha256");
  let carry = Buffer.alloc(0);
  let processed = 0;
  const encoder = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const bytes = Buffer.from(chunk);
        sourceHash.update(bytes);
        processed += bytes.length;
        report(request.jobId, processed);
        const merged = carry.length === 0 ? bytes : Buffer.concat([carry, bytes]);
        const safeLength = merged.length - (merged.length % 3);
        carry = merged.subarray(safeLength);
        callback(null, safeLength === 0 ? undefined : Buffer.from(merged.subarray(0, safeLength).toString("base64"), "ascii"));
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        callback(null, carry.length === 0 ? undefined : Buffer.from(carry.toString("base64"), "ascii"));
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  await pipeline(createReadStream(request.sourcePath), encoder, createWriteStream(request.temporaryOutputPath, { flags: "wx", mode: 0o600 }));
  const encoded = await readBoundedUtf8(request.temporaryOutputPath, CONVERTER_MAX_OUTPUT_BYTES);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) throw new Error("Base64 output validation failed.");
  const decoded = Buffer.from(encoded, "base64");
  if (createHash("sha256").update(decoded).digest("hex") !== sourceHash.digest("hex")) throw new Error("Base64 output digest validation failed.");
  return outputSize(request.temporaryOutputPath);
}

async function convertBase64ToBinary(request: WorkerRequest): Promise<number> {
  const text = await readBoundedUtf8(request.sourcePath);
  report(request.jobId, Buffer.byteLength(text, "utf8"));
  const normalized = text.replace(/\s/gu, "");
  if (normalized.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(normalized)) {
    throw new Error("Base64 input is invalid.");
  }
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.toString("base64") !== normalized || decoded.length > CONVERTER_MAX_OUTPUT_BYTES) throw new Error("Base64 input is not canonical or exceeds the output limit.");
  await fsp.writeFile(request.temporaryOutputPath, decoded, { flag: "wx", mode: 0o600 });
  const reopened = await fsp.readFile(request.temporaryOutputPath);
  if (reopened.toString("base64") !== normalized) throw new Error("Decoded binary output validation failed.");
  return outputSize(request.temporaryOutputPath);
}

async function run(request: WorkerRequest): Promise<WorkerSuccess> {
  if (!request || request.kind !== "convert" || typeof request.jobId !== "string" || typeof request.sourcePath !== "string" || typeof request.temporaryOutputPath !== "string") {
    throw new Error("Malformed converter worker request.");
  }
  let outputBytes: number;
  switch (request.adapterId) {
    case "structured-json-pretty": outputBytes = await convertJsonPretty(request); break;
    case "structured-json-to-csv": outputBytes = await convertJsonToCsv(request); break;
    case "text-normalize-utf8": outputBytes = await convertNormalizedText(request); break;
    case "binary-to-base64": outputBytes = await convertBinaryToBase64(request); break;
    case "base64-to-binary": outputBytes = await convertBase64ToBinary(request); break;
    default: throw new Error("Unallowlisted converter adapter.");
  }
  return { kind: "complete", jobId: request.jobId, outputBytes };
}

workerPort.on("message", (request: WorkerRequest) => {
  void run(request).then(
    (result) => workerPort.postMessage(result),
    (error: unknown) => workerPort.postMessage({ kind: "error", jobId: request?.jobId ?? "", error: normalizeError(error) }),
  );
});
