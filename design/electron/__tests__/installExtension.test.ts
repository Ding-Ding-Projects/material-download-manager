import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BROWSER_EXTENSION_DIRECTORY_NAME,
  browserExtensionTarget,
  installBrowserExtension,
  installedExtensionPath,
  resolveBundledExtensionRoot,
} from "../extension/installExtension";

async function makeSource(root: string): Promise<string> {
  const source = path.join(root, "extension");
  await fsp.mkdir(path.join(source, "src"), { recursive: true });
  await fsp.mkdir(path.join(source, "docs"), { recursive: true });
  await fsp.writeFile(path.join(source, "manifest.json"), '{"manifest_version":3,"name":"x","version":"0.0.0"}');
  await fsp.writeFile(path.join(source, "src", "service-worker.js"), "// worker");
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

    assert.equal(await installedExtensionPath(userData), null);

    const installed = await installBrowserExtension(source, userData);
    assert.equal(installed, browserExtensionTarget(userData));
    assert.equal(path.basename(installed), BROWSER_EXTENSION_DIRECTORY_NAME);

    // manifest.json sits at the target root so Load unpacked works directly.
    await fsp.access(path.join(installed, "manifest.json"));
    await fsp.access(path.join(installed, "src", "service-worker.js"));
    await fsp.access(path.join(installed, "README.md"));

    assert.equal(await installedExtensionPath(userData), installed);
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

    const installed = await installBrowserExtension(source, userData);
    const stale = path.join(installed, "src", "stale-file.js");
    await fsp.writeFile(stale, "// left over from an older version");
    await fsp.access(stale);

    await installBrowserExtension(source, userData);
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

    await assert.rejects(() => installBrowserExtension(source, userData), /service-worker\.js|missing/);
    // A refused install leaves nothing half-staged that would look installed.
    assert.equal(await installedExtensionPath(userData), null);
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
