#!/usr/bin/env node

// Ensures node_modules/electron actually contains its platform binary.
//
// Two verified host failures make this necessary:
// - npm 11's install-script gate can leave the electron package installed
//   without ever running its install script, so dist/electron.exe is missing.
// - electron's own install.js downloads and extracts asynchronously; on a host
//   whose Node runtime exits before that async work settles, install.js can
//   exit 0 with dist/ still empty or half-extracted.
//
// Every step here is synchronous, and success is judged only by the binary
// existing afterwards — never by an exit code alone.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const APP_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const ELECTRON_DIRECTORY = path.join(APP_DIRECTORY, "node_modules", "electron");
const DIST_DIRECTORY = path.join(ELECTRON_DIRECTORY, "dist");

function fail(message) {
  process.stderr.write(`ensure-electron-binary: ${message}\n`);
  process.exit(1);
}

function platformExecutable() {
  switch (process.platform) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "linux":
    case "freebsd":
    case "openbsd":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron builds are not available on platform: ${process.platform}`);
  }
}

function binaryPresent(executableRelativePath) {
  return fs.existsSync(path.join(DIST_DIRECTORY, executableRelativePath));
}

function writePathFile(executableRelativePath) {
  fs.writeFileSync(path.join(ELECTRON_DIRECTORY, "path.txt"), executableRelativePath);
}

function electronVersion() {
  const manifestPath = path.join(ELECTRON_DIRECTORY, "package.json");
  if (!fs.existsSync(manifestPath)) fail(`electron package is not installed: ${manifestPath} is missing; run npm ci first`);
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")).version;
}

function expectedChecksum(assetName) {
  const checksumsPath = path.join(ELECTRON_DIRECTORY, "checksums.json");
  if (!fs.existsSync(checksumsPath)) return null;
  const checksums = JSON.parse(fs.readFileSync(checksumsPath, "utf8"));
  return typeof checksums[assetName] === "string" ? checksums[assetName] : null;
}

function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function cacheRootCandidates() {
  const roots = [];
  if (process.env.electron_config_cache) roots.push(process.env.electron_config_cache);
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    roots.push(path.join(process.env.LOCALAPPDATA, "electron", "Cache"));
  } else if (process.platform === "darwin") {
    roots.push(path.join(os.homedir(), "Library", "Caches", "electron"));
  } else {
    roots.push(path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "electron"));
  }
  return roots.filter((root) => fs.existsSync(root));
}

function findCachedZip(assetName) {
  for (const root of cacheRootCandidates()) {
    const direct = path.join(root, assetName);
    if (fs.existsSync(direct)) return direct;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, entry.name, assetName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function downloadZip(url, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${destinationPath}'`],
      { stdio: "inherit", timeout: 600_000 }
    );
  } else {
    execFileSync("curl", ["-fsSL", "-o", destinationPath, url], { stdio: "inherit", timeout: 600_000 });
  }
  if (!fs.existsSync(destinationPath)) throw new Error(`download produced no file at ${destinationPath}`);
}

function extractZip(zipPath) {
  fs.rmSync(DIST_DIRECTORY, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIRECTORY, { recursive: true });
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `$ProgressPreference='SilentlyContinue'; Expand-Archive -Path '${zipPath}' -DestinationPath '${DIST_DIRECTORY}' -Force`],
      { stdio: "inherit", timeout: 600_000 }
    );
  } else {
    execFileSync("unzip", ["-oq", zipPath, "-d", DIST_DIRECTORY], { stdio: "inherit", timeout: 600_000 });
  }
}

function main() {
  const executableRelativePath = platformExecutable();
  if (binaryPresent(executableRelativePath)) {
    writePathFile(executableRelativePath);
    process.stdout.write("ensure-electron-binary: electron binary is already present\n");
    return;
  }

  // First give electron's own installer a chance; judge it by the binary, not
  // by its exit code, because it can exit 0 without finishing.
  const installScript = path.join(ELECTRON_DIRECTORY, "install.js");
  if (fs.existsSync(installScript)) {
    spawnSync(process.execPath, [installScript], { cwd: ELECTRON_DIRECTORY, stdio: "inherit", timeout: 600_000 });
    if (binaryPresent(executableRelativePath)) {
      writePathFile(executableRelativePath);
      process.stdout.write("ensure-electron-binary: electron install script produced the binary\n");
      return;
    }
  }

  const version = electronVersion();
  const arch = process.env.npm_config_arch || process.arch;
  const assetName = `electron-v${version}-${process.platform}-${arch}.zip`;
  const expected = expectedChecksum(assetName);

  let zipPath = findCachedZip(assetName);
  if (zipPath && expected && sha256(zipPath) !== expected) {
    process.stderr.write(`ensure-electron-binary: cached ${assetName} failed its checksum; re-downloading\n`);
    zipPath = null;
  }
  if (!zipPath) {
    const url = `https://github.com/electron/electron/releases/download/v${version}/${assetName}`;
    zipPath = path.join(os.tmpdir(), `ensure-electron-${process.pid}-${assetName}`);
    process.stdout.write(`ensure-electron-binary: downloading ${url}\n`);
    downloadZip(url, zipPath);
    if (expected && sha256(zipPath) !== expected) fail(`downloaded ${assetName} does not match the checksum recorded in electron/checksums.json`);
  }

  process.stdout.write(`ensure-electron-binary: extracting ${zipPath}\n`);
  extractZip(zipPath);
  if (!binaryPresent(executableRelativePath)) fail(`extraction finished but ${executableRelativePath} is still missing under ${DIST_DIRECTORY}`);
  writePathFile(executableRelativePath);
  process.stdout.write("ensure-electron-binary: electron binary restored from verified archive\n");
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
