import { cp, lstat, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const argumentsList = process.argv.slice(2);
const packageOnly = argumentsList.includes("--package-only");
const unknownOptions = argumentsList.filter((argument) => argument.startsWith("--") && argument !== "--package-only");
if (unknownOptions.length > 0) throw new Error(`Unknown site build option: ${unknownOptions[0]}`);
if (!packageOnly) execFileSync(process.execPath, [path.join(siteRoot, "check.mjs")], { cwd: siteRoot, stdio: "inherit" });

const outputArgument = argumentsList.find((argument) => !argument.startsWith("--"));
const requestedOutput = outputArgument ? path.resolve(outputArgument) : null;
const repositoryRoot = path.resolve(siteRoot, "..");
const outputRoot = requestedOutput ?? await mkdtemp(path.join(os.tmpdir(), "material-download-manager-site-"));
if (requestedOutput) {
  const outputRootWithSeparator = `${outputRoot}${path.sep}`;
  const repositoryRootWithSeparator = `${repositoryRoot}${path.sep}`;
  const filesystemRoot = path.parse(outputRoot).root;
  if (
    outputRoot === filesystemRoot ||
    outputRoot === repositoryRoot ||
    outputRoot.startsWith(repositoryRootWithSeparator) ||
    repositoryRoot.startsWith(outputRootWithSeparator)
  ) {
    throw new Error("Site build output must be a new directory outside the repository and its ancestors.");
  }
  try {
    const existing = await lstat(outputRoot);
    throw new Error(`Site build output already exists (${existing.isSymbolicLink() ? "symbolic link" : "filesystem entry"}): ${outputRoot}`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
}
const files = ["index.html", "styles.css", "converter.css", "ollama-suite.css", "app.js", "converter.js", "ollama-suite.js", "content.js", "data", "assets"];
const runtimeScripts = [
  "./content.js",
  "./data/universal-feature-manifest.js",
  "./data/settings-contract.js",
  "./data/notification-contract.js",
  "./data/converter-contract.js",
  "./data/release-manifest-contract.js",
  "./data/release-manifest.js",
  "./data/ollama-suite-contract.js",
  "./app.js",
  "./ollama-suite.js"
  ,"./converter.js"
];
for (const file of files) await cp(path.join(siteRoot, file), path.join(outputRoot, file), { recursive: true });

const builtHtml = await readFile(path.join(outputRoot, "index.html"), "utf8");
for (const script of runtimeScripts) {
  await lstat(path.join(outputRoot, script.slice(2)));
  if (!builtHtml.includes(`<script src="${script}"></script>`)) throw new Error(`Built HTML is missing local runtime script parity for ${script}.`);
}
console.log(`BUILD RESULT: PASS (temporary output ${outputRoot})`);
