import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const contractSource = await readFile(path.join(siteRoot, "data", "logo-customization-contract.js"), "utf8");
const controllerSource = await readFile(path.join(siteRoot, "logo-customization.js"), "utf8");
const workerSource = await readFile(path.join(siteRoot, "logo-image-worker.js"), "utf8");
const cssSource = await readFile(path.join(siteRoot, "logo-customization.css"), "utf8");
const documentation = await readFile(path.resolve(siteRoot, "..", "docs", "features", "site", "app-logo-customization.md"), "utf8");

function loadContract(source = contractSource) {
  const sandbox = { Uint8Array, ArrayBuffer, Buffer, Intl };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "logo-customization-contract.js" });
  return sandbox.MDM_SITE_LOGO_CONTRACT;
}

const contract = loadContract();

let passed = 0;
async function test(name, callback) {
  await callback();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

function bytes(...groups) {
  return Uint8Array.from(groups.flatMap((group) => [...group]));
}

function uint32(value) {
  return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function ascii(value) { return Uint8Array.from([...value].map((character) => character.charCodeAt(0))); }

function pngChunk(type, data) {
  return bytes(uint32(data.length), ascii(type), data, Uint8Array.from([0, 0, 0, 0]));
}

function png(width = 1, height = 1, extras = [], colorType = 6) {
  return bytes(
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", bytes(uint32(width), uint32(height), Uint8Array.from([8, colorType, 0, 0, 0]))),
    ...extras,
    pngChunk("IDAT", Uint8Array.from([0])),
    pngChunk("IEND", Uint8Array.from([]))
  );
}

function dataUri(mime, value) {
  return `data:${mime};base64,${Buffer.from(value).toString("base64")}`;
}

function incompleteJpeg() {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9
  ]);
}

function sourceSet(overrides = {}) {
  return {
    contract: overrides.contract || contractSource,
    controller: overrides.controller || controllerSource,
    worker: overrides.worker || workerSource,
    css: overrides.css || cssSource
  };
}

function validateImplementation(source) {
  assert.match(source.contract, /function inspectImageBytes\(/, "actual-byte inspection must be registered exactly");
  assert.match(source.contract, /type === "acTL"\) \{\s*return invalid\("animated-png-not-supported"\);/s, "animated PNG rejection must remain exact");
  assert.match(source.contract, /function buildSafeExport\(/, "safe export boundary must remain registered");
  assert.match(source.contract, /configuration\.schemaVersion === SCHEMA_VERSION/, "safe configuration versions must fail closed");
  assert.match(source.controller, /new Worker\("\.\/logo-image-worker\.js"\)/, "controller must retain the isolated decoder registration");
  assert.match(source.controller, /file\.arrayBuffer\(\)/, "controller must inspect local bytes, not a filename");
  assert.match(source.controller, /const descriptor = contract\.inspectImageBytes\(bytes\);/, "controller must call actual-byte inspection before decode");
  assert.match(source.controller, /const logo = contract\.resolveLogo\(renderableLogo\(rawLogo\)\);/, "render must route cached custom state through the validated fallback boundary");
  assert.match(source.controller, /candidate\.valid \? await verifyIsolatedDecode\(candidate\.bytes\)/, "rehydrated custom data must reach the isolated decoder");
  assert.match(source.controller, /function commitLogoSafely\(/, "storage failures must be converted to a truthful result");
  assert.match(source.controller, /try \{\s*worker = new Worker\("\.\/logo-image-worker\.js"\);/s, "worker construction failures must fail closed");
  assert.match(source.controller, /if \(persisted\) context\?\.notify\?\./, "success notifications require durable persistence");
  assert.doesNotMatch(source.controller, /file\.name/, "source filenames must never enter the logo controller");
  assert.doesNotMatch(source.controller, /\bfetch\s*\(/, "logo controller must not use a network route");
  assert.doesNotMatch(source.controller, /XMLHttpRequest/, "logo controller must not use a network route");
  assert.match(source.worker, /importScripts\("\.\/data\/logo-customization-contract\.js"\)/, "worker must load only the bundled local contract");
  assert.match(source.worker, /const inspected = self\.MDM_SITE_LOGO_CONTRACT\.inspectImageBytes\(bytes\);/, "worker must inspect actual bytes before bitmap decode");
  assert.match(source.worker, /createImageBitmap\([\s\S]*imageOrientation: "none"/, "worker must decode with raw-orientation dimensions");
  assert.match(source.worker, /const offlineOnly = \(\) => \{ throw new Error\("Logo validation worker is local-only\."\); \};/, "worker offline primitive must throw");
  assert.match(source.worker, /fetch: \{ value: offlineOnly, configurable: false, writable: false \}/, "worker fetch must be fail-closed after its one bundled import");
  assert.match(source.worker, /importScripts: \{ value: offlineOnly, configurable: false, writable: false \}/, "worker imports must be locked after bundled import");
  assert.doesNotMatch(source.css, /text-overflow:\s*ellipsis/, "bilingual preset labels must not be truncated");
  assert.match(source.css, /@media \(max-width: 44rem\)\s*\{\s*\.logo-preset-grid \{ grid-template-columns: 1fr; \}/s, "narrow layout must reflow logo presets");
}

function loadWorker() {
  const listeners = new Map();
  const imports = [];
  const messages = [];
  const sandbox = {
    Uint8Array,
    ArrayBuffer,
    Blob,
    MDM_SITE_LOGO_CONTRACT: contract,
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
    addEventListener(type, handler) { listeners.set(type, handler); },
    postMessage(message) { messages.push(message); },
    importScripts(pathname) { imports.push(pathname); }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(workerSource, sandbox, { filename: "logo-image-worker.js" });
  return { sandbox, listeners, imports, messages };
}

function loadController({ Worker, getLogoState, commitLogo = () => true, notify = () => {} }) {
  const document = {
    hidden: false,
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const sandbox = {
    document,
    Worker,
    MDM_SITE_LOGO_CONTRACT: contract,
    requestAnimationFrame(callback) { callback(); return 1; },
    setTimeout() { return 1; },
    clearTimeout() {},
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    addEventListener() {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(controllerSource, sandbox, { filename: "logo-customization.js" });
  sandbox.MDM_SITE_LOGO_CUSTOMIZATION.initialize({
    getLogoState,
    commitLogo,
    getLanguage: () => "en",
    getFunnyLevel: () => 1,
    notify,
    selectSettingsTab() {}
  });
  return sandbox.MDM_SITE_LOGO_CUSTOMIZATION;
}

await test("the contract has bounded image formats, exact shipped presets, and localized failure coverage", () => {
  assert.equal(contract.MAX_INPUT_BYTES, 1572864);
  assert.equal(contract.MAX_WIDTH, 4096);
  assert.equal(contract.MAX_HEIGHT, 4096);
  assert.equal(contract.MAX_PIXELS, 12000000);
  assert.deepEqual(JSON.parse(JSON.stringify(contract.FITS)), ["contain", "cover", "fill"]);
  assert.deepEqual(JSON.parse(JSON.stringify(contract.BACKGROUND_MODES)), ["transparent", "color"]);
  assert.deepEqual(JSON.parse(JSON.stringify(contract.PRESETS.map((preset) => preset.id))), ["transfer", "queue", "relay"]);
  for (const reason of contract.FAILURE_REASONS) assert.match(controllerSource, new RegExp(`"${reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}": \\[`), `${reason} has English and Cantonese display copy`);
});

await test("still PNG bytes, including valid tRNS transparency, are structurally bounded", () => {
  const result = contract.inspectImageBytes(png());
  assert.equal(result.valid, true);
  assert.equal(result.format, "png");
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.equal(result.hasAlpha, true);
  const indexedTransparency = contract.inspectImageBytes(png(1, 1, [pngChunk("tRNS", Uint8Array.from([0]))], 3));
  assert.equal(indexedTransparency.valid, true);
  assert.equal(indexedTransparency.hasAlpha, true);
});

await test("malformed, animated, spoofed, oversized, and incomplete image bytes fail closed", () => {
  assert.equal(contract.inspectImageBytes(Uint8Array.from([1, 2, 3])).reason, "unsupported-image-format");
  assert.equal(contract.inspectImageBytes(png(5000, 1)).reason, "png-dimensions-exceed-limit");
  assert.equal(contract.inspectImageBytes(png(1, 1, [pngChunk("acTL", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 0]))])).reason, "animated-png-not-supported");
  assert.equal(contract.inspectImageBytes(incompleteJpeg()).reason, "incomplete-jpeg");
  assert.equal(contract.parseDataUri(dataUri("image/jpeg", png())).reason, "custom-data-uri-mime-mismatch");
});

await test("safe configuration and private cache separate custom bytes and reject unsupported schema versions", () => {
  const validUri = dataUri("image/png", png());
  const logo = contract.normalizeLogoSettings({ selection: { kind: "custom", dataUri: validUri, filename: "not-retained.png", path: "C:\\private\\not-retained.png" } });
  assert.equal(logo.selection.kind, "custom");
  assert.equal(logo.selection.filename, undefined);
  assert.equal(logo.selection.path, undefined);
  const generic = contract.buildSafeSettingsRecord(logo);
  const privateCache = contract.buildPrivateCache(logo);
  assert.equal(generic.selection.kind, "custom");
  assert.equal(generic.selection.dataUri, undefined);
  assert.ok(privateCache.dataUri.startsWith("data:image/png;base64,"));
  assert.equal(contract.hydrateLogoSettings(generic, privateCache).selection.kind, "custom");
  assert.equal(contract.hydrateLogoSettings(generic, null).selection.kind, "preset");
  assert.equal(contract.hydrateLogoSettings({ ...generic, schemaVersion: 999 }, privateCache).selection.kind, "preset");
  assert.equal(contract.normalizePrivateCache({ ...privateCache, schemaVersion: 1 }), null);
});

await test("safe export redacts image bytes and source details", () => {
  const exportPayload = contract.buildSafeExport({ selection: { kind: "custom", dataUri: dataUri("image/png", png()) } });
  const serialized = JSON.stringify(exportPayload);
  assert.equal(exportPayload.selection.customImageBytes, "omitted");
  assert.equal(exportPayload.selection.originalFilename, "never stored");
  assert.doesNotMatch(serialized, /data:image\//);
  assert.doesNotMatch(serialized, /private|not-retained/i);
});

await test("local schedule rules have stable IDs, date and weekday boundaries, timezone semantics, and deterministic precedence", () => {
  const logo = contract.normalizeLogoSettings({
    schedule: {
      timezone: "UTC",
      rules: [
        { id: "logo-low", label: "Low priority", enabled: true, priority: 10, start: "18:00", end: "08:00", weekdays: ["thu"], presetId: "queue" },
        { id: "logo-high", label: "High priority", enabled: true, priority: 20, startDate: "2026-01-01", endDate: "2026-01-31", start: "00:00", end: "00:00", weekdays: ["thu"], presetId: "relay" }
      ]
    }
  });
  assert.equal(logo.schedule.rules[0].id, "logo-low");
  assert.equal(logo.schedule.rules[1].label, "High priority");
  const resolved = contract.resolveLogo(logo, new Date("2026-01-01T19:00:00Z"));
  assert.equal(resolved.scheduled, true);
  assert.equal(resolved.scheduleRule.id, "logo-high");
  assert.equal(resolved.selection.presetId, "relay");
  const overnight = contract.resolveLogo({ schedule: { timezone: "UTC", rules: [{ id: "logo-overnight", enabled: true, start: "18:00", end: "08:00", weekdays: ["thu"], presetId: "queue" }] } }, new Date("2026-01-02T07:59:00Z"));
  assert.equal(overnight.scheduled, true, "Friday early morning belongs to Thursday's cross-midnight rule");
  const equal = contract.resolveLogo({ schedule: { timezone: "UTC", rules: [{ id: "logo-all-day", enabled: true, start: "08:00", end: "08:00", weekdays: ["thu"], presetId: "queue" }] } }, new Date("2026-01-01T12:00:00Z"));
  assert.equal(equal.scheduled, true, "equal endpoints mean all day");
});

await test("worker executes actual-byte inspection, raw-orientation decode, and fail-closed local-only primitives", async () => {
  const worker = loadWorker();
  assert.deepEqual(worker.imports, ["./data/logo-customization-contract.js"]);
  assert.throws(() => worker.sandbox.fetch(), /local-only/);
  assert.throws(() => worker.sandbox.importScripts("https://example.invalid/"), /local-only/);
  assert.equal(worker.sandbox.XMLHttpRequest, undefined);
  await worker.listeners.get("message")({ data: { kind: "validate-logo-image", bytes: png().buffer } });
  assert.equal(worker.messages.at(-1).ok, true);
  assert.equal(worker.messages.at(-1).descriptor.format, "png");
});

await test("cached custom state falls back when worker construction fails and persistence exceptions stay non-throwing", async () => {
  const uri = dataUri("image/png", png());
  const generic = contract.buildSafeSettingsRecord(contract.normalizeLogoSettings({ selection: { kind: "custom", dataUri: uri } }));
  const cache = { schemaVersion: contract.SCHEMA_VERSION, dataUri: uri };
  let current = contract.hydrateLogoSettings(generic, cache);
  let commits = 0;
  loadController({
    Worker: class { constructor() { throw new Error("CSP refusal"); } },
    getLogoState: () => current,
    commitLogo(next) { commits += 1; current = next; return true; }
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(commits, 1);
  assert.equal(current.selection.kind, "preset");
  for (const outcome of [false, () => { throw new Error("quota"); }]) {
    const controller = loadController({
      Worker: class {},
      getLogoState: () => contract.normalizeLogoSettings(null),
      commitLogo: typeof outcome === "function" ? outcome : () => outcome
    });
    assert.doesNotThrow(() => controller.reset());
  }
});

await test("implementation, documentation, and narrow bilingual CSS retain the local-only contract", () => {
  validateImplementation(sourceSet());
  assert.match(documentation, /same-origin dedicated worker/);
  assert.match(documentation, /no source path or\s+original filename is stored/);
  assert.match(documentation, /three-second completion bound/);
  assert.match(documentation, /safe export action/);
});

await test("every hand-written implementation boundary has a deliberate red mutation", () => {
  const mutations = [
    ["byte-inspection declaration", () => sourceSet({ contract: contractSource.replace("function inspectImageBytes(", "function removedImageInspection(") }), /actual-byte inspection/],
    ["animated PNG rejection", () => sourceSet({ contract: contractSource.replace('return invalid("animated-png-not-supported");', 'return invalid("removed-animation-rejection");') }), /animated PNG rejection/],
    ["safe export boundary", () => sourceSet({ contract: contractSource.replace("function buildSafeExport(", "function removedSafeExport(") }), /safe export boundary/],
    ["safe schema rejection", () => sourceSet({ contract: contractSource.replace("configuration.schemaVersion === SCHEMA_VERSION", "configuration.schemaVersion === 0") }), /safe configuration versions/],
    ["worker registration", () => sourceSet({ controller: controllerSource.replace('new Worker("./logo-image-worker.js")', 'new Worker("./removed-worker.js")') }), /isolated decoder registration/],
    ["local byte read", () => sourceSet({ controller: controllerSource.replace("file.arrayBuffer()", "file.text()") }), /inspect local bytes/],
    ["controller byte call", () => sourceSet({ controller: controllerSource.replace("const descriptor = contract.inspectImageBytes(bytes);", "const descriptor = { valid: true };") }), /actual-byte inspection before decode/],
    ["render cache boundary", () => sourceSet({ controller: controllerSource.replace("const logo = contract.resolveLogo(renderableLogo(rawLogo));", "const logo = contract.resolveLogo(rawLogo);") }), /cached custom state/],
    ["rehydration worker call", () => sourceSet({ controller: controllerSource.replace("candidate.valid ? await verifyIsolatedDecode(candidate.bytes)", "candidate.valid ? { ok: true }") }), /isolated decoder/],
    ["durable commit guard", () => sourceSet({ controller: controllerSource.replace("function commitLogoSafely(", "function removedCommitLogoSafely(") }), /storage failures/],
    ["worker construction catch", () => sourceSet({ controller: controllerSource.replace("try {\n      worker = new Worker", "worker = new Worker") }), /worker construction failures/],
    ["success notification guard", () => sourceSet({ controller: controllerSource.replace("if (persisted) context?.notify?.", "if (true) context?.notify?.") }), /success notifications/],
    ["filename denylist", () => sourceSet({ controller: `${controllerSource}\nvoid file.name;` }), /source filenames/],
    ["fetch denylist", () => sourceSet({ controller: `${controllerSource}\nfetch("https://example.invalid/");` }), /network route/],
    ["XHR denylist", () => sourceSet({ controller: `${controllerSource}\nnew XMLHttpRequest();` }), /network route/],
    ["worker local import", () => sourceSet({ worker: workerSource.replace("./data/logo-customization-contract.js", "./data/removed-contract.js") }), /bundled local contract/],
    ["worker byte call", () => sourceSet({ worker: workerSource.replace("const inspected = self.MDM_SITE_LOGO_CONTRACT.inspectImageBytes(bytes);", "const inspected = { valid: true };") }), /inspect actual bytes/],
    ["raw orientation", () => sourceSet({ worker: workerSource.replace('imageOrientation: "none"', 'imageOrientation: "from-image"') }), /raw-orientation/],
    ["worker throwing primitive", () => sourceSet({ worker: workerSource.replace('const offlineOnly = () => { throw new Error("Logo validation worker is local-only."); };', "const offlineOnly = () => undefined;") }), /offline primitive/],
    ["worker fetch lock", () => sourceSet({ worker: workerSource.replace("fetch: { value: offlineOnly, configurable: false, writable: false }", "fetch: { value: self.fetch, configurable: false, writable: false }") }), /worker fetch/],
    ["worker import lock", () => sourceSet({ worker: workerSource.replace("importScripts: { value: offlineOnly, configurable: false, writable: false }", "importScripts: { value: self.importScripts, configurable: false, writable: false }") }), /worker imports/],
    ["bilingual CSS", () => sourceSet({ css: cssSource.replace("overflow-wrap: anywhere; white-space: normal;", "text-overflow: ellipsis;") }), /bilingual preset labels/],
    ["narrow CSS", () => sourceSet({ css: cssSource.replace("@media (max-width: 44rem)", "@media (max-width: 40rem)") }), /narrow layout/]
  ];
  for (const [name, mutate, expected] of mutations) assert.throws(() => validateImplementation(mutate()), expected, `${name} mutation must turn the Chut red`);
});

console.log(`LOGO CONTRACT: ${passed}/${passed} passed`);
