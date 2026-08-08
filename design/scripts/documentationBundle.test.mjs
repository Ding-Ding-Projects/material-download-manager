import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const designRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(designRoot, "..");
const bundlePath = path.join(designRoot, "src", "generated", "documentationArticles.ts");

function runGenerator() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(designRoot, "scripts", "generate-documentation-bundle.mjs"), "--check"], {
      cwd: designRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("the generated offline documentation bundle is complete and current", async () => {
  const result = await runGenerator();
  assert.equal(result.code, 0, result.stderr);
  const bundle = await readFile(bundlePath, "utf8");
  assert.match(bundle, /DOCUMENTATION_ARTICLES/);
  assert.match(bundle, /features\/site\/landing-and-documentation-site\.md/);
  assert.match(bundle, /features\/documentation\/in-app-documentation-browser\.md/);
  assert.match(bundle, /features\/download-engine\/auto-organize-downloads\.md/);
  assert.match(bundle, /# Auto-organize downloads/);
});

test("the generated bundle lives inside the renderer source and is present", async () => {
  await access(bundlePath);
  assert.ok(bundlePath.startsWith(path.join(repositoryRoot, "design")));
});
