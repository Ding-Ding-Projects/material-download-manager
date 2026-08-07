import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(siteRoot, "..");
const checks = [];

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
  "assets/dim-sum.svg"
];
for (const relativePath of expectedFiles) {
  await exists(relativePath);
  pass(`required file ${relativePath}`);
}

const html = await read("index.html");
const css = await read("styles.css");
const app = await read("app.js");
const contentSource = await read("content.js");
const manifestJsonSource = await read("data/release-manifest.json");
const manifestJsSource = await read("data/release-manifest.js");
const content = loadScript(contentSource, "content.js", "MDM_SITE_CONTENT");
const manifestFromJs = loadScript(manifestJsSource, "release-manifest.js", "MDM_RELEASE_MANIFEST");
const manifestFromJson = JSON.parse(manifestJsonSource);

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
  for (const id of ["features", "changelog", "settings", "palette", "tab-strip", "tab-group", "tab-groups", "tab-master"]) {
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
  assert.equal(content.features.length, 12);
  const ids = new Set(content.features.map((feature) => feature.id));
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
    assert.ok(release.installer === null || typeof release.installer === "object");
  }
});

run("release content preserves the stable/test distinction", () => {
  const release = content.releases.find((item) => item.version === "0.1.0");
  assert.ok(release);
  assert.equal(release.channel, "test prerelease");
  assert.equal(release.installer, null);
  assert.match(release.summary, /not a stable production installer/i);
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
