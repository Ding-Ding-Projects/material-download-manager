import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(siteRoot, "check.mjs")], { cwd: siteRoot, stdio: "inherit" });

const requestedOutput = process.argv[2] ? path.resolve(process.argv[2]) : null;
const repositoryRoot = path.resolve(siteRoot, "..");
const outputRoot = requestedOutput ?? await mkdtemp(path.join(os.tmpdir(), "material-download-manager-site-"));
if (requestedOutput) {
  if (outputRoot === siteRoot || outputRoot === repositoryRoot || outputRoot.startsWith(`${siteRoot}${path.sep}`)) {
    throw new Error("Site build output must be outside the source site directory.");
  }
  await rm(outputRoot, { recursive: true, force: true });
}
const files = ["index.html", "styles.css", "app.js", "content.js", "data", "assets"];
for (const file of files) await cp(path.join(siteRoot, file), path.join(outputRoot, file), { recursive: true });

const builtHtml = await readFile(path.join(outputRoot, "index.html"), "utf8");
if (!builtHtml.includes("./data/release-manifest.js") || !builtHtml.includes("./app.js")) throw new Error("Built HTML is missing local runtime scripts.");
console.log(`BUILD RESULT: PASS (temporary output ${outputRoot})`);
