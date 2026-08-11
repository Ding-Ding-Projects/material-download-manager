import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(siteRoot, "..");
const checks = [];
const pagesManifestPreparer = await readFile(path.join(repoRoot, "scripts", "prepare-pages-release-manifest.ps1"), "utf8");
const prototypeMockup = await readFile(path.join(repoRoot, "prototype", "AB Download Manager M3.dc.html"), "utf8");

async function read(relativePath) {
  return readFile(path.join(siteRoot, relativePath), "utf8");
}

function pass(label) {
  checks.push(`PASS ${label}`);
}

function run(label, assertion) {
  try {
    assertion();
    pass(label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

async function exists(relativePath) {
  await stat(path.join(siteRoot, relativePath));
}

function loadScript(source, filename, globalName) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename });
  return context.window[globalName];
}

async function walk(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path.join(directory, entry.name), relative));
    else result.push(relative);
  }
  return result;
}

const universalStatuses = new Set(["implemented", "partial", "planned"]);

function validateUniversalFeatureManifest(candidate, sourceCorpus) {
  assert.equal(candidate?.schemaVersion, 1, "schemaVersion must be 1");
  assert.equal(candidate?.surface, "GitHub Pages landing and documentation site", "surface must name the Pages site");
  assert.ok(Array.isArray(candidate?.requiredIds) && candidate.requiredIds.length > 0, "requiredIds must be a non-empty hand-written list");
  assert.ok(Array.isArray(candidate?.features) && candidate.features.length > 0, "features must be a non-empty hand-written list");
  const requiredIds = new Set(candidate.requiredIds);
  assert.equal(requiredIds.size, candidate.requiredIds.length, "requiredIds must be unique");
  const ids = new Set();
  for (const feature of candidate.features) {
    assert.match(String(feature?.id || ""), /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `invalid feature id: ${feature?.id}`);
    assert.ok(!ids.has(feature.id), `duplicate feature id: ${feature.id}`);
    ids.add(feature.id);
    assert.ok(requiredIds.has(feature.id), `feature is not in requiredIds: ${feature.id}`);
    assert.equal(feature.required, undefined, `${feature.id} must use the manifest requiredIds list rather than an inferred flag`);
    assert.ok(typeof feature.title === "string" && feature.title.trim(), `${feature.id} needs a title`);
    assert.ok(typeof feature.category === "string" && feature.category.trim(), `${feature.id} needs a category`);
    assert.ok(Array.isArray(feature.requiredSurfaces) && feature.requiredSurfaces.length > 0, `${feature.id} needs required surfaces`);
    assert.ok(typeof feature.docsPath === "string" && feature.docsPath.trim(), `${feature.id} needs a docs path`);
    const docsPath = path.resolve(siteRoot, feature.docsPath);
    assert.ok(docsPath.startsWith(`${repoRoot}${path.sep}`), `${feature.id} docs path escapes the repository`);
    assert.ok(universalStatuses.has(feature.status), `${feature.id} has an unsupported status`);
    assert.ok(Array.isArray(feature.probes) && feature.probes.length > 0, `${feature.id} needs verification probes`);
    feature.probes.forEach((probe) => assert.match(String(probe), /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${feature.id} has an invalid probe id`));
    assert.ok(Array.isArray(feature.runtimeAnchors), `${feature.id} runtimeAnchors must be an array`);
    feature.runtimeAnchors.forEach((anchor) => assert.ok(typeof anchor === "string" && anchor.length > 0, `${feature.id} has an empty runtime anchor`));
    if (feature.status === "planned") {
      assert.equal(feature.runtimeAnchors.length, 0, `${feature.id} cannot claim runtime anchors while planned`);
    } else {
      assert.ok(feature.runtimeAnchors.length > 0, `${feature.id} needs runtime anchors while ${feature.status}`);
      feature.runtimeAnchors.forEach((anchor) => assert.ok(sourceCorpus.includes(anchor), `${feature.id} runtime anchor is missing: ${anchor}`));
    }
  }
  candidate.requiredIds.forEach((id) => assert.ok(ids.has(id), `required feature record is missing: ${id}`));
  assert.equal(ids.size, requiredIds.size, "feature records and requiredIds must have the same coverage");
  return candidate.features;
}

const expectedFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "content.js",
  "package.json",
  "README.md",
  "check.mjs",
  "build.mjs",
  "data/release-manifest.json",
  "data/release-manifest.js",
  "data/universal-feature-manifest.js",
  "data/settings-contract.js",
  "data/notification-contract.js",
  "assets/dim-sum.svg"
];
for (const relativePath of expectedFiles) {
  await exists(relativePath);
  pass(`required file ${relativePath}`);
}

const html = await read("index.html");
const css = await read("styles.css");
const app = await read("app.js");
const buildSource = await read("build.mjs");
const contentSource = await read("content.js");
const manifestJsonSource = await read("data/release-manifest.json");
const manifestJsSource = await read("data/release-manifest.js");
const universalFeatureManifestSource = await read("data/universal-feature-manifest.js");
const settingsContractSource = await read("data/settings-contract.js");
const notificationContractSource = await read("data/notification-contract.js");
const content = loadScript(contentSource, "content.js", "MDM_SITE_CONTENT");
const manifestFromJs = loadScript(manifestJsSource, "release-manifest.js", "MDM_RELEASE_MANIFEST");
const universalFeatureManifest = loadScript(universalFeatureManifestSource, "universal-feature-manifest.js", "MDM_UNIVERSAL_FEATURE_MANIFEST");
const settingsContract = loadScript(settingsContractSource, "settings-contract.js", "MDM_SITE_SETTINGS_CONTRACT");
const notificationContract = loadScript(notificationContractSource, "notification-contract.js", "MDM_SITE_NOTIFICATION_CONTRACT");
const manifestFromJson = JSON.parse(manifestJsonSource);

run("site builder never recursively removes a caller-selected output path", () => {
  assert.doesNotMatch(buildSource, /\brm\s*\(/);
  assert.match(buildSource, /output already exists/);
  assert.match(buildSource, /outside the repository and its ancestors/);
});

run("HTML has language, viewport, skip link, main landmark, and tab semantics", () => {
  assert.match(html, /<html lang="en"/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /id="main-content"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-orientation="vertical"/);
});

run("site exposes the required keyboard command palette shortcut", () => {
  assert.match(html, /Ctrl\+Shift\+F/);
  assert.match(app, /event\.ctrlKey && event\.shiftKey/);
});

run("site has local search fields with individual regex-builder anchors", () => {
  for (const id of ["features", "changelog", "settings", "palette", "notifications", "tab-strip", "tab-group", "tab-groups", "tab-master"]) {
    assert.match(html, new RegExp(`data-search-id="${id}"`));
    assert.match(html, new RegExp(`builder-${id}`));
  }
  assert.match(app, /data-builder-pattern/);
  assert.match(app, /JavaScript RegExp/);
});

run("release manifest JSON and browser form agree", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(manifestFromJs)), manifestFromJson);
  assert.equal(manifestFromJson.schemaVersion, 1);
  assert.equal(manifestFromJson.stable, null);
});

const universalSourceCorpus = `${html}\n${css}\n${app}\n${contentSource}\n${universalFeatureManifestSource}\n${notificationContractSource}`;
const universalFeatureEntries = validateUniversalFeatureManifest(universalFeatureManifest, universalSourceCorpus);
run("universal feature manifest is explicit and independently validated", () => {
  assert.equal(universalFeatureEntries.length, universalFeatureManifest.requiredIds.length);
  assert.ok(universalFeatureEntries.some((feature) => feature.status === "planned"), "pending contract entries must remain visible");
});
run("universal manifest validator rejects missing records, duplicates, unsafe docs, and missing probes", () => {
  const missing = JSON.parse(JSON.stringify(universalFeatureManifest));
  missing.features.shift();
  assert.throws(() => validateUniversalFeatureManifest(missing, universalSourceCorpus), /required feature record is missing/);

  const duplicate = JSON.parse(JSON.stringify(universalFeatureManifest));
  duplicate.features.push({ ...duplicate.features[0] });
  assert.throws(() => validateUniversalFeatureManifest(duplicate, universalSourceCorpus), /duplicate feature id/);

  const unsafeDocs = JSON.parse(JSON.stringify(universalFeatureManifest));
  unsafeDocs.features[0].docsPath = "../../outside.md";
  assert.throws(() => validateUniversalFeatureManifest(unsafeDocs, universalSourceCorpus), /escapes the repository/);

  const missingProbe = JSON.parse(JSON.stringify(universalFeatureManifest));
  const emojiFeature = missingProbe.features.find((feature) => feature.id === "emoji-toggle");
  emojiFeature.runtimeAnchors = [];
  assert.throws(() => validateUniversalFeatureManifest(missingProbe, universalSourceCorpus), /needs runtime anchors/);
});
for (const feature of universalFeatureEntries) {
  await stat(path.resolve(siteRoot, feature.docsPath));
  pass(`universal article source exists for ${feature.id}`);
}
const pendingUniversal = universalFeatureEntries.filter((feature) => feature.status !== "implemented");
console.log(`UNIVERSAL COVERAGE: ${universalFeatureEntries.length - pendingUniversal.length} implemented, ${pendingUniversal.length} partial/planned; no pending entry is treated as shipped.`);

run("emoji and School settings have an executable versioned state contract", () => {
  assert.equal(typeof settingsContract.normalizeSettingsRecord, "function");
  assert.equal(typeof settingsContract.effectiveSettings, "function");
  assert.equal(typeof settingsContract.filterSchoolCopy, "function");
  const defaults = {
    schemaVersion: 2,
    revision: 0,
    language: "en",
    funnyEn: 3,
    funnyYue: 3,
    showEmojis: true,
    theme: "system",
    density: "comfortable",
    accent: "#6750A4",
    fontScale: 100,
    tabPosition: "left"
  };
  const migrated = settingsContract.normalizeSettingsRecord({
    language: "yue",
    funnyEn: 5,
    funnyYue: 4,
    showEmojis: false,
    schoolModeEnabled: true,
    schoolModeName: " Focus\u0000 mode ",
    unknownSecret: "must be ignored"
  }, defaults, "School mode", "Material Download Manager");
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.language, "yue", "the saved language remains recoverable");
  assert.equal(migrated.funnyEn, 5, "the saved funny level remains recoverable");
  assert.equal(migrated.showEmojis, false);
  assert.equal(migrated.schoolMode.enabled, true);
  assert.equal(migrated.schoolMode.name, "Focus mode");
  assert.equal(migrated.unknownSecret, undefined, "unknown storage fields are not copied into runtime state");
  assert.deepEqual(JSON.parse(JSON.stringify(settingsContract.effectiveSettings(migrated))), { language: "en", funnyEn: 1, funnyYue: 1, showEmojis: false, schoolMode: true });
  assert.equal(settingsContract.filterSchoolCopy("Cantonese · bilingual · funny · emoji · 蝦餃 · School mode", migrated, "Focus mode"), "English-only · English-only · English-only · English-only · · Focus mode");
  assert.equal(settingsContract.normalizeLabel("\r\n", "School mode", 48), "School mode");
  assert.equal(settingsContract.normalizeLabel("\u202EFocus\u202C", "School mode", 48), "Focus");
});

run("emoji and School controls are wired to persistence, reset, and live suppression", () => {
  for (const marker of ["SETTINGS_SCHEMA_VERSION = 2", "mdm-site-settings-v2", "showEmojis", "schoolMode", "setSchoolMode", "resetSchoolMode", "bindSettingsSync", "applySchoolModeSurface", "effectiveShowEmojis"]) assert.match(app, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const marker of ["id=\"show-emojis\"", "id=\"school-mode-name\"", "id=\"school-mode-enabled\"", "id=\"reset-school-mode\"", "data-school-optional", "data-school-language-option"]) assert.ok(html.includes(marker), `${marker} is present`);
  assert.match(html, /data\/settings-contract\.js/);
  assert.match(html, /data\/universal-feature-manifest\.js/);
  assert.match(app, /window\.addEventListener\("storage"/);
  assert.match(app, /marker\.setAttribute\("aria-hidden", "true"\)/);
});

run("notification history contract bounds text, tones, filters, and exports", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(notificationContract.tones)), ["info", "success", "progress", "warning", "error"]);
  assert.equal(notificationContract.normalizeTone("unknown-tone"), "info", "unknown tones normalize to info");
  const record = notificationContract.normalizeRecord({
    id: "notice-1",
    tone: "warning",
    title: `${"T".repeat(300)}\u202E`,
    message: `${"M".repeat(800)}\u0000`,
    createdAt: "2026-08-11T00:00:00Z",
    dismissed: true,
    secret: "must be dropped"
  }, 0);
  assert.equal(record.title.length, 160);
  assert.equal(record.message.length, 600);
  assert.equal(record.dismissed, true);
  assert.equal(record.secret, undefined);
  assert.equal(notificationContract.normalizeRecords([record, record]).length, 1, "duplicate IDs are collapsed before persistence");
  const records = [record, { id: "active-1", tone: "success", title: "Active", message: "Ready", createdAt: "2026-08-11T00:01:00Z", dismissed: false }, { id: "error-1", tone: "error", title: "Error", message: "Failed", createdAt: "2026-08-11T00:02:00Z", dismissed: false }];
  assert.equal(notificationContract.filterRecords(records, { filter: "active" }).length, 2);
  assert.equal(notificationContract.filterRecords(records, { filter: "dismissed" }).length, 1);
  assert.equal(notificationContract.filterRecords(records, { filter: "errors" }).length, 2);
  const exported = notificationContract.buildExport(records, { filter: "active", query: "ready", mode: "text" }, "2026-08-11T00:03:00Z");
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.filter, "active");
  assert.equal(exported.records.length, 3, "export preserves the explicitly supplied visible scope");
  assert.equal(exported.records[0].secret, undefined);
});

run("notification centre is wired to persistence, search, bulk actions, School suppression, and focus", () => {
  for (const marker of ["NOTIFICATION_HISTORY_KEY", "function renderNotificationCentre", "function bulkDismissNotifications", "function openNotificationDeleteConfirm", "function exportVisibleNotifications", "notificationState.selected", "if (!region || isSchoolMode()) return", "window.addEventListener(\"storage\""]) assert.match(app, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const marker of ["id=\"notification-centre-open\"", "id=\"notification-centre\"", "id=\"notifications-search\"", "data-search-id=\"notifications\"", "id=\"notification-select-all\"", "id=\"notification-select-inverse\"", "id=\"notification-bulk-dismiss\"", "id=\"notification-bulk-delete\"", "id=\"notification-export\"", "id=\"notification-delete-confirm\"", "id=\"notification-delete-ack\"", "id=\"notification-delete-phrase\""]) assert.ok(html.includes(marker), `${marker} is present`);
  assert.match(html, /data\/notification-contract\.js/);
  assert.match(css, /\.notification-centre\s*\{/);
  assert.match(css, /\.notification-record\s*\{/);
  assert.match(app, /notificationContract\.buildExport/);
  assert.match(app, /notificationState\.view\.filter/);
});

run("stable installer is absent until verified metadata exists", () => {
  assert.doesNotMatch(html, /data-stable-installer/);
  assert.match(app, /releaseIsStableVerified/);
  assert.match(app, /record\.verified === true/);
  assert.match(app, /\["Setup\.exe", "RELEASES"\]\.every/);
  assert.match(app, /record\.assets\.includes\(name\)/);
  assert.match(app, /slot\.replaceChildren\(\)/);
});

run("site has no remote asset loading or external font imports", () => {
  const assetMarkup = `${html}\n${css}\n${app}`;
  assert.doesNotMatch(assetMarkup, /(?:src|href)\s*=\s*["']https?:\/\//i);
  assert.doesNotMatch(assetMarkup, /url\(\s*["']?https?:\/\//i);
  assert.doesNotMatch(assetMarkup, /@import\s+url/i);
  assert.doesNotMatch(assetMarkup, /fonts\.googleapis|cdnjs\.cloudflare|unpkg\.com|jsdelivr\.net/i);
});

run("local image asset has meaningful alternative text", () => {
  const image = html.match(/<img\b[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/i);
  assert.ok(image, "image element is present");
  assert.ok(image[1].startsWith("./"), "image source is local");
  assert.ok(image[2].length > 10, "image alternative text is descriptive");
});

run("feature article inventory covers every embedded feature", () => {
  assert.equal(content.features.length, 17);
  const ids = new Set(content.features.map((feature) => feature.id));
  assert.ok(ids.has("auto-organize-downloads"), "auto-organize article is in the explicit feature inventory");
  for (const feature of content.features) {
    assert.ok(feature.title && feature.summary && feature.category, `${feature.id} has identity fields`);
    assert.deepEqual(Object.keys(feature.sections).sort(), ["behavior", "configuration", "failureModes", "security", "verification"]);
    assert.ok(feature.suggested.every((id) => ids.has(id)), `${feature.id} suggestions resolve`);
    assert.ok(feature.docsPath.startsWith("../docs/features/"), `${feature.id} uses categorized docs path`);
    const docsPath = path.resolve(siteRoot, feature.docsPath);
    assert.ok(docsPath.startsWith(repoRoot), `${feature.id} docs path stays inside repository`);
  }
});

for (const feature of content.features) {
  const docsPath = path.resolve(siteRoot, feature.docsPath);
  await stat(docsPath);
  pass(`article source exists for ${feature.id}`);
}

run("release entries carry full source commits and honest dates", () => {
  assert.ok(Array.isArray(content.releases) && content.releases.length > 0);
  for (const release of content.releases) {
    assert.match(release.commit, /^[0-9a-f]{40}$/);
    assert.ok(release.commitUrl.startsWith("https://github.com/"));
    assert.ok(release.releaseDate === null || /^\d{4}-\d{2}-\d{2}$/.test(release.releaseDate));
    assert.ok(release.installer === null || typeof release.installer === "object" || (release.verified === true && typeof release.installerUrl === "string"));
    if (release.verified === true) {
      assert.match(release.installerUrl, /^https:\/\//);
      assert.ok(Array.isArray(release.assets) && release.assets.includes("Setup.exe") && release.assets.includes("RELEASES"));
    }
  }
});

run("release content preserves the stable/test distinction", () => {
  const release = content.releases.find((item) => item.version === "0.1.0");
  assert.ok(release);
  assert.equal(release.channel, "test prerelease");
  assert.equal(release.installer, null);
  assert.match(release.summary, /not a stable production installer/i);
});

run("Pages publication states share one verified contract", () => {
  assert.match(pagesManifestPreparer, /pages = 'verified'/);
  assert.match(pagesManifestPreparer, /pages = 'unverified'/);
  assert.match(app, /\["verified", "workflow-deployed"\]\.includes\(manifest\.publication\?\.pages\)/);
  assert.doesNotMatch(app, /self-hosted Pages workflow/i);
  assert.match(app, /hosted Pages workflow/i);
});

run("public prototype guidance contains no host-specific sample paths", () => {
  assert.doesNotMatch(prototypeMockup, /C:\\\\Users\\\\you\\\\Downloads/i);
});

run("settings provide persisted language, independent tone, appearance, motion, and tab controls", () => {
  for (const marker of ["localStorage", "funnyEn", "funnyYue", "appearanceOverrides", "reducedMotion", "tabPosition", "resetSettings"]) assert.match(app, new RegExp(marker));
  for (const marker of ["id=\"funny-en\"", "id=\"funny-yue\"", "id=\"appearance-target\"", "id=\"reduced-motion\"", "id=\"tab-discovery-grid\""]) assert.ok(html.includes(marker), `${marker} is present`);
});

const svg = await read("assets/dim-sum.svg");
run("local SVG is an illustration, not a photographic catalog copy", () => {
  assert.match(svg, /<svg/);
  assert.doesNotMatch(svg, /data:image|photo|stock/i);
});

const inventory = await walk(siteRoot);
run("site inventory has no photographic files or generated output", () => {
  const files = inventory;
  assert.ok(!files.some((file) => /\.(png|jpe?g|webp|gif)$/i.test(file)), "no photographic raster files");
  assert.ok(!files.some((file) => /(^|[\\/])(dist|build|node_modules)([\\/]|$)/i.test(file)), "no generated/dependency directory");
});

const packageJson = JSON.parse(await read("package.json"));
run("site package declares no runtime dependencies", () => {
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.equal(packageJson.scripts.check, "node check.mjs");
  assert.equal(packageJson.scripts.build, "node build.mjs");
});

console.log(checks.join("\n"));
console.log(`CHECK RESULT: PASS (${checks.length} checks)`);
