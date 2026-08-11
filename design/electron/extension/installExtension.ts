import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Stages the bundled Chromium extension into a stable folder under the app's
 * user-data directory so the user can point Chrome's "Load unpacked" at it.
 * The folder deliberately has no version suffix: Chrome keeps loading the same
 * path across app updates, and a re-install refreshes the files in place.
 */
export const BROWSER_EXTENSION_DIRECTORY_NAME = "browser-extension";

const REQUIRED_PAYLOAD = ["manifest.json", path.join("src", "service-worker.js")];
const PAYLOAD_ENTRIES = ["manifest.json", "src", "README.md", "docs"];
const CAPABILITY_MODULE = path.join("src", "shared", "pairing.js");
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

async function isPresent(candidate: string): Promise<boolean> {
  try {
    await fsp.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function assertLoadablePayload(root: string, label: string): Promise<void> {
  for (const entry of REQUIRED_PAYLOAD) {
    if (!(await isPresent(path.join(root, entry)))) {
      throw new Error(`${label} is missing ${entry}; refusing to offer an unloadable extension`);
    }
  }
}

/**
 * Where the extension source lives for this process. A packaged build carries
 * it as an extraResource beside the asar; a development run reads the
 * repository's extension/ directory next to design/.
 */
export function resolveBundledExtensionRoot(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appRoot: string;
}): string {
  if (options.isPackaged) {
    return path.join(options.resourcesPath, BROWSER_EXTENSION_DIRECTORY_NAME);
  }
  return path.resolve(options.appRoot, "..", "extension");
}

/** The stable install target below the user-data directory. */
export function browserExtensionTarget(userDataPath: string): string {
  return path.join(userDataPath, BROWSER_EXTENSION_DIRECTORY_NAME);
}

/** Returns the installed folder when it holds a loadable payload, else null. */
export async function installedExtensionPath(userDataPath: string): Promise<string | null> {
  const target = browserExtensionTarget(userDataPath);
  try {
    await assertLoadablePayload(target, "installed extension");
    return target;
  } catch {
    return null;
  }
}

/**
 * Copy the bundled extension to the stable target, replacing any previous
 * install so stale files never linger, and verify the result actually loads
 * before reporting success.
 */
export async function installBrowserExtension(sourceRoot: string, userDataPath: string, capability: string): Promise<string> {
  await assertLoadablePayload(sourceRoot, "bundled extension source");
  if (!CAPABILITY_PATTERN.test(capability)) {
    throw new Error("A valid per-install handoff capability is required");
  }

  const target = browserExtensionTarget(userDataPath);
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.mkdir(target, { recursive: true });
  for (const entry of PAYLOAD_ENTRIES) {
    const sourceEntry = path.join(sourceRoot, entry);
    if (!(await isPresent(sourceEntry))) continue;
    await fsp.cp(sourceEntry, path.join(target, entry), { recursive: true });
  }
  const capabilityModulePath = path.join(target, CAPABILITY_MODULE);
  await fsp.mkdir(path.dirname(capabilityModulePath), { recursive: true });
  await fsp.writeFile(
    capabilityModulePath,
    `// Generated only in the app's private staged extension folder.\nexport const HANDOFF_CAPABILITY = ${JSON.stringify(capability)};\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  await assertLoadablePayload(target, "installed extension");
  return target;
}
