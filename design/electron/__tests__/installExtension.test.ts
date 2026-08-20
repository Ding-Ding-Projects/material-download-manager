import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CHROME_EXTENSIONS_PAGE,
  createBrowserExtensionInstallResult,
  isBrowserChromeExtensionsResult,
  isBrowserExtensionInstallState,
  isBrowserExtensionInstallResult,
} from "../../shared/types";
import {
  BROWSER_EXTENSION_DIRECTORY_NAME,
  browserExtensionInstallState,
  browserExtensionTarget,
  installBrowserExtension,
  installedExtensionPath,
  openChromeExtensionsPage,
  resolveBundledExtensionRoot,
} from "../extension/installExtension";

const TEST_CAPABILITY = "a".repeat(43);
const STATIC_ICON_PATHS = Object.freeze({
  16: "assets/icons/icon16.png",
  32: "assets/icons/icon32.png",
  48: "assets/icons/icon48.png",
  128: "assets/icons/icon128.png",
});

function staticIconPng(size: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes[19] = size;
  bytes[23] = size;
  return bytes;
}

test("extension install result keeps staging success separate from folder-open state", async () => {
  const openedPaths: string[] = [];
  const opened = await createBrowserExtensionInstallResult("C:/AppData/browser-extension", async (folderPath) => {
    openedPaths.push(folderPath);
    return "";
  });
  assert.deepEqual(openedPaths, ["C:/AppData/browser-extension"]);
  assert.deepEqual(opened, {
    installed: true,
    path: "C:/AppData/browser-extension",
    folderOpened: true,
    folderOpenError: null,
  });
  assert.equal(isBrowserExtensionInstallResult(opened), true);

  const refused = await createBrowserExtensionInstallResult("C:/AppData/browser-extension", async () => "No file manager is available");
  assert.deepEqual(refused, {
    installed: true,
    path: "C:/AppData/browser-extension",
    folderOpened: false,
    folderOpenError: "No file manager is available",
  });
  assert.equal(isBrowserExtensionInstallResult(refused), true);

  const rejected = await createBrowserExtensionInstallResult("C:/AppData/browser-extension", async () => {
    throw new Error("Folder launch was refused");
  });
  assert.deepEqual(rejected, {
    installed: true,
    path: "C:/AppData/browser-extension",
    folderOpened: false,
    folderOpenError: "Folder launch was refused",
  });
  assert.equal(isBrowserExtensionInstallResult(rejected), true);

  assert.equal(isBrowserExtensionInstallResult({ installed: true, path: "C:/extension" }), false);
  assert.equal(isBrowserExtensionInstallResult({ installed: true, path: "C:/extension", folderOpened: true, folderOpenError: "contradiction" }), false);
  assert.equal(isBrowserExtensionInstallResult({ installed: true, path: "C:/extension", folderOpened: false, folderOpenError: null }), false);
});

async function makeSource(root: string): Promise<string> {
  const source = path.join(root, "extension");
  await fsp.mkdir(path.join(source, "src"), { recursive: true });
  await fsp.mkdir(path.join(source, "docs"), { recursive: true });
  await fsp.mkdir(path.join(source, "assets", "icons"), { recursive: true });
  await fsp.writeFile(path.join(source, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "x",
    version: "0.0.0",
    background: { service_worker: "src/service-worker.js" },
    icons: STATIC_ICON_PATHS,
    action: { default_icon: STATIC_ICON_PATHS },
  }));
  await fsp.writeFile(path.join(source, "src", "service-worker.js"), "// worker");
  for (const [sizeText, relativePath] of Object.entries(STATIC_ICON_PATHS)) {
    await fsp.writeFile(path.join(source, relativePath), staticIconPng(Number(sizeText)));
  }
  await fsp.writeFile(path.join(source, "README.md"), "# extension");
  await fsp.writeFile(path.join(source, "docs", "contract.md"), "# contract");
  return source;
}

test("installBrowserExtension stages a loadable payload and reports it installed", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ext-install-"));
  try {
    const source = await makeSource(root);
    const userData = path.join(root, "userData");
    await fsp.mkdir(userData, { recursive: true });

    assert.equal(await installedExtensionPath(userData, TEST_CAPABILITY), null);

    const installed = await installBrowserExtension(source, userData, TEST_CAPABILITY);
    assert.equal(installed, browserExtensionTarget(userData));
    assert.equal(path.basename(installed), BROWSER_EXTENSION_DIRECTORY_NAME);

    // manifest.json sits at the target root so Load unpacked works directly.
    await fsp.access(path.join(installed, "manifest.json"));
    await fsp.access(path.join(installed, "src", "service-worker.js"));
    await fsp.access(path.join(installed, "assets", "icons", "icon128.png"));
    assert.match(await fsp.readFile(path.join(installed, "src", "shared", "pairing.js"), "utf8"), new RegExp(TEST_CAPABILITY));
    await fsp.access(path.join(installed, "README.md"));

    assert.equal(await installedExtensionPath(userData, TEST_CAPABILITY), installed);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("installBrowserExtension replaces stale files on reinstall", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ext-reinstall-"));
  try {
    const source = await makeSource(root);
    const userData = path.join(root, "userData");
    await fsp.mkdir(userData, { recursive: true });

    const installed = await installBrowserExtension(source, userData, TEST_CAPABILITY);
    const stale = path.join(installed, "src", "stale-file.js");
    await fsp.writeFile(stale, "// left over from an older version");
    await fsp.access(stale);

    await installBrowserExtension(source, userData, "b".repeat(43));
    await assert.rejects(() => fsp.access(stale), "reinstall must clear stale files");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("installBrowserExtension refuses an incomplete source", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ext-bad-"));
  try {
    const source = path.join(root, "extension");
    await fsp.mkdir(source, { recursive: true });
    await fsp.writeFile(path.join(source, "manifest.json"), "{}"); // no src/service-worker.js
    const userData = path.join(root, "userData");
    await fsp.mkdir(userData, { recursive: true });

    await assert.rejects(() => installBrowserExtension(source, userData, TEST_CAPABILITY), /service-worker\.js|missing/);
    // A refused install leaves nothing half-staged that would look installed.
    assert.equal(await installedExtensionPath(userData, TEST_CAPABILITY), null);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("installBrowserExtension rejects a missing or malformed static manifest icon", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ext-static-icon-"));
  try {
    const source = await makeSource(root);
    const userData = path.join(root, "userData");
    await fsp.mkdir(userData, { recursive: true });

    await fsp.rm(path.join(source, STATIC_ICON_PATHS[48]));
    await assert.rejects(() => installBrowserExtension(source, userData, TEST_CAPABILITY), /static icon.*missing/i);

    await fsp.writeFile(path.join(source, STATIC_ICON_PATHS[48]), staticIconPng(16));
    await assert.rejects(() => installBrowserExtension(source, userData, TEST_CAPABILITY), /48 x 48 PNG/);
    assert.equal(await installedExtensionPath(userData, TEST_CAPABILITY), null);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("resolveBundledExtensionRoot maps packaged and development layouts", () => {
  const packaged = resolveBundledExtensionRoot({
    isPackaged: true,
    resourcesPath: path.join("C:", "app", "resources"),
    appRoot: path.join("C:", "app", "resources", "app.asar"),
  });
  assert.equal(packaged, path.join("C:", "app", "resources", BROWSER_EXTENSION_DIRECTORY_NAME));

  const development = resolveBundledExtensionRoot({
    isPackaged: false,
    resourcesPath: path.join("C:", "ignored"),
    appRoot: path.join("C:", "repo", "design"),
  });
  assert.equal(development, path.resolve(path.join("C:", "repo", "design"), "..", "extension"));
});

test("installBrowserExtension validates Manifest V3 and preserves the previous install when capability commit fails", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ext-transaction-"));
  try {
    const source = await makeSource(root);
    const userData = path.join(root, "userData");
    await fsp.mkdir(userData, { recursive: true });
    const first = await installBrowserExtension(source, userData, TEST_CAPABILITY);
    const firstPairing = await fsp.readFile(path.join(first, "src", "shared", "pairing.js"), "utf8");

    await assert.rejects(
      () => installBrowserExtension(source, userData, "b".repeat(43), async () => { throw new Error("vault unavailable"); }),
      /vault unavailable/,
    );
    assert.equal(await fsp.readFile(path.join(first, "src", "shared", "pairing.js"), "utf8"), firstPairing);
    assert.equal((await browserExtensionInstallState(userData, TEST_CAPABILITY)).installed, true);

    await fsp.writeFile(path.join(source, "manifest.json"), '{"manifest_version":2}');
    await assert.rejects(() => installBrowserExtension(source, userData, "c".repeat(43)), /Manifest V3/);
    assert.equal((await browserExtensionInstallState(userData, TEST_CAPABILITY)).installed, true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("browser extension install state rejects a malformed staged capability", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ext-state-malformed-"));
  try {
    const source = await makeSource(root);
    const userData = path.join(root, "userData");
    await fsp.mkdir(userData, { recursive: true });
    const installed = await installBrowserExtension(source, userData, TEST_CAPABILITY);
    const pairingPath = path.join(installed, "src", "shared", "pairing.js");
    await fsp.writeFile(pairingPath, "export const HANDOFF_CAPABILITY = 'not-a-capability';\n");

    assert.deepEqual(await browserExtensionInstallState(userData, TEST_CAPABILITY), { installed: false, path: null });
    assert.equal(await installedExtensionPath(userData, TEST_CAPABILITY), null);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("concurrent extension installs serialize and leave one complete pairing", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ext-concurrent-"));
  try {
    const source = await makeSource(root);
    const userData = path.join(root, "userData");
    await fsp.mkdir(userData, { recursive: true });
    const firstCapability = "d".repeat(43);
    const secondCapability = "e".repeat(43);
    await Promise.all([
      installBrowserExtension(source, userData, firstCapability),
      installBrowserExtension(source, userData, secondCapability),
    ]);

    const pairing = await fsp.readFile(path.join(browserExtensionTarget(userData), "src", "shared", "pairing.js"), "utf8");
    const finalCapability = pairing.match(/HANDOFF_CAPABILITY = ["']([A-Za-z0-9_-]{43})["']/u)?.[1];
    assert.ok(finalCapability === firstCapability || finalCapability === secondCapability);
    assert.equal((await browserExtensionInstallState(userData, finalCapability)).installed, true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("extension install rejects a redirected manifest path", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ext-symlink-"));
  try {
    const source = await makeSource(root);
    const realManifest = path.join(root, "real-manifest.json");
    await fsp.rename(path.join(source, "manifest.json"), realManifest);
    try {
      await fsp.symlink(realManifest, path.join(source, "manifest.json"));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
        t.skip(`symlink creation is unavailable (${code})`);
        return;
      }
      throw error;
    }

    const userData = path.join(root, "userData");
    await fsp.mkdir(userData, { recursive: true });
    await assert.rejects(
      () => installBrowserExtension(source, userData, TEST_CAPABILITY),
      /redirected|unsafe|missing/,
    );
    assert.equal(await installedExtensionPath(userData, TEST_CAPABILITY), null);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("browser extension install state survives a renderer remount by reading the staged payload", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ext-state-"));
  try {
    const source = await makeSource(root);
    const userData = path.join(root, "userData");
    await fsp.mkdir(userData, { recursive: true });
    const before = await browserExtensionInstallState(userData, TEST_CAPABILITY);
    assert.deepEqual(before, { installed: false, path: null });
    assert.equal(isBrowserExtensionInstallState(before), true);

    const installed = await installBrowserExtension(source, userData, TEST_CAPABILITY);
    const after = await browserExtensionInstallState(userData, TEST_CAPABILITY);
    assert.deepEqual(after, { installed: true, path: installed });
    assert.equal(isBrowserExtensionInstallState(after), true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("Chrome extensions action uses only the fixed internal page and reports refusal safely", async () => {
  const opened: string[] = [];
  const success = await openChromeExtensionsPage(async (url) => { opened.push(url); });
  assert.deepEqual(opened, [CHROME_EXTENSIONS_PAGE]);
  assert.deepEqual(success, { opened: true, url: CHROME_EXTENSIONS_PAGE, error: null });
  assert.equal(isBrowserChromeExtensionsResult(success), true);

  const refused = await openChromeExtensionsPage(async () => { throw new Error("Chrome is unavailable"); });
  assert.deepEqual(refused, { opened: false, url: CHROME_EXTENSIONS_PAGE, error: "Chrome is unavailable" });
  assert.equal(isBrowserChromeExtensionsResult(refused), true);

  const started = Date.now();
  const timedOut = await openChromeExtensionsPage(async () => new Promise<void>(() => undefined));
  assert.ok(Date.now() - started < 3_000, "a hanging shell request must have a bounded result");
  assert.equal(timedOut.opened, false);
  assert.equal(timedOut.url, CHROME_EXTENSIONS_PAGE);
  assert.match(timedOut.error ?? "", /timed out/i);
  assert.equal(isBrowserChromeExtensionsResult(timedOut), true);

  assert.equal(isBrowserChromeExtensionsResult({ opened: true, url: "https://example.test", error: null }), false);
  assert.equal(isBrowserChromeExtensionsResult({ opened: false, url: CHROME_EXTENSIONS_PAGE, error: null }), false);
});
