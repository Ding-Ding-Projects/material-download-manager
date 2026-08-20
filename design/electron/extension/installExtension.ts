import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  CHROME_EXTENSIONS_PAGE,
  type BrowserChromeExtensionsResult,
  type BrowserExtensionInstallState,
} from "../../shared/types";

/**
 * Stages the bundled Chromium extension into a stable folder under the app's
 * user-data directory so the user can point Chrome's "Load unpacked" at it.
 * The folder deliberately has no version suffix: Chrome keeps loading the same
 * path across app updates, and a re-install refreshes the files in place.
 */
export const BROWSER_EXTENSION_DIRECTORY_NAME = "browser-extension";

const REQUIRED_PAYLOAD = ["manifest.json", path.join("src", "service-worker.js")];
const PAYLOAD_ENTRIES = ["manifest.json", "src", "assets", "README.md", "docs"];
const CAPABILITY_MODULE = path.join("src", "shared", "pairing.js");
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CHROME_OPEN_TIMEOUT_MS = 2_000;
const STATIC_ICON_PATHS = Object.freeze({
  16: "assets/icons/icon16.png",
  32: "assets/icons/icon32.png",
  48: "assets/icons/icon48.png",
  128: "assets/icons/icon128.png",
});
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let installQueue: Promise<unknown> = Promise.resolve();

function enqueueInstall<T>(operation: () => Promise<T>): Promise<T> {
  const next = installQueue.then(operation, operation);
  installQueue = next.then(() => undefined, () => undefined);
  return next;
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0
    && !path.isAbsolute(value)
    && value.split(/[\\/]+/u).every((part) => part.length > 0 && part !== "." && part !== "..");
}

async function assertRegularPath(candidate: string, label: string): Promise<void> {
  let stat;
  try {
    stat = await fsp.lstat(candidate);
  } catch {
    throw new Error(`${label} is missing; refusing an unloadable extension`);
  }
  if (stat.isSymbolicLink() || stat.isBlockDevice() || stat.isCharacterDevice() || stat.isSocket() || stat.isFIFO()) {
    throw new Error(`${label} is a redirected or special file; refusing an unsafe extension payload`);
  }
}

async function isPresent(candidate: string): Promise<boolean> {
  try {
    const stat = await fsp.lstat(candidate);
    return !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function assertStaticExtensionIcons(root: string, record: Record<string, unknown>, label: string): Promise<void> {
  const action = record.action;
  if (!record.icons || typeof record.icons !== "object" || !action || typeof action !== "object") {
    throw new Error(`${label} must declare packaged static extension icons`);
  }
  const defaultIcon = (action as Record<string, unknown>).default_icon;
  if (!defaultIcon || typeof defaultIcon !== "object") {
    throw new Error(`${label} must declare action.default_icon static fallbacks`);
  }

  for (const [sizeText, expectedPath] of Object.entries(STATIC_ICON_PATHS)) {
    for (const [iconSetLabel, iconSet] of [["icons", record.icons], ["action.default_icon", defaultIcon]] as const) {
      if ((iconSet as Record<string, unknown>)[sizeText] !== expectedPath) {
        throw new Error(`${label} ${iconSetLabel}[${sizeText}] must be ${expectedPath}`);
      }
    }
    if (!isSafeRelativePath(expectedPath)) throw new Error(`${label} declared an unsafe static icon path`);
    const candidate = path.join(root, expectedPath);
    await assertRegularPath(candidate, `${label} static icon ${expectedPath}`);
    const stat = await fsp.lstat(candidate);
    if (!stat.isFile() || stat.size < 33 || stat.size > 512 * 1024) {
      throw new Error(`${label} static icon ${expectedPath} is not a bounded regular file`);
    }
    const bytes = await fsp.readFile(candidate);
    if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
      || bytes.subarray(12, 16).toString("ascii") !== "IHDR"
      || bytes[16] !== 0 || bytes[17] !== 0 || bytes[18] !== 0 || bytes[19] !== Number(sizeText)
      || bytes[20] !== 0 || bytes[21] !== 0 || bytes[22] !== 0 || bytes[23] !== Number(sizeText)) {
      throw new Error(`${label} static icon ${expectedPath} is not the declared ${sizeText} x ${sizeText} PNG`);
    }
  }
}

async function assertLoadablePayload(root: string, label: string, requireCapability = false): Promise<void> {
  await assertRegularPath(root, label);
  const rootStat = await fsp.lstat(root);
  if (!rootStat.isDirectory()) throw new Error(`${label} is not a directory; refusing an unloadable extension`);
  for (const entry of REQUIRED_PAYLOAD) {
    const candidate = path.join(root, entry);
    await assertRegularPath(candidate, `${label} ${entry}`);
    const stat = await fsp.lstat(candidate);
    if (entry.endsWith(".js") && !stat.isFile()) throw new Error(`${label} ${entry} is not a file`);
    if (entry === "manifest.json" && !stat.isFile()) throw new Error(`${label} manifest.json is not a file`);
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(await fsp.readFile(path.join(root, "manifest.json"), "utf8"));
  } catch {
    throw new Error(`${label} manifest.json is not valid JSON`);
  }
  if (!manifest || typeof manifest !== "object") throw new Error(`${label} manifest.json is not an object`);
  const record = manifest as Record<string, unknown>;
  if (record.manifest_version !== 3) throw new Error(`${label} manifest.json must use Manifest V3`);
  const background = record.background;
  if (!background || typeof background !== "object" || typeof (background as Record<string, unknown>).service_worker !== "string") {
    throw new Error(`${label} manifest.json must declare a background service worker`);
  }
  await assertStaticExtensionIcons(root, record, label);
  const declaredFiles = [
    (background as Record<string, unknown>).service_worker,
    record.options_page,
    record.action && typeof record.action === "object" ? (record.action as Record<string, unknown>).default_popup : undefined,
  ].filter((value): value is string => typeof value === "string");
  for (const file of declaredFiles) {
    if (!isSafeRelativePath(file)) throw new Error(`${label} manifest references an unsafe path`);
    const candidate = path.join(root, file);
    await assertRegularPath(candidate, `${label} ${file}`);
    const stat = await fsp.lstat(candidate);
    if (!stat.isFile()) throw new Error(`${label} manifest file ${file} is not a regular file`);
  }

  const capabilityPath = path.join(root, CAPABILITY_MODULE);
  if (await isPresent(capabilityPath)) {
    await assertRegularPath(capabilityPath, `${label} ${CAPABILITY_MODULE}`);
    const capabilityText = await fsp.readFile(capabilityPath, "utf8");
    const match = capabilityText.match(/HANDOFF_CAPABILITY\s*=\s*["']([A-Za-z0-9_-]{43})["']/u);
    if (!match && requireCapability) throw new Error(`${label} pairing module does not contain a valid private capability`);
  } else if (requireCapability) {
    throw new Error(`${label} is missing its private pairing module`);
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

/**
 * Return the current app-prepared extension state without opening anything.
 * This is intentionally derived from the loadable payload rather than from a
 * renderer-only flag, so it survives app restarts and Settings remounts.
 */
export async function browserExtensionInstallState(userDataPath: string, expectedCapability?: string | null): Promise<BrowserExtensionInstallState> {
  const target = browserExtensionTarget(userDataPath);
  try {
    await assertLoadablePayload(target, "installed extension", true);
    if (!expectedCapability || !CAPABILITY_PATTERN.test(expectedCapability)) return { installed: false, path: null };
    const pairing = await fsp.readFile(path.join(target, CAPABILITY_MODULE), "utf8");
    if (!pairing.includes(`HANDOFF_CAPABILITY = ${JSON.stringify(expectedCapability)}`)) return { installed: false, path: null };
    return { installed: true, path: target };
  } catch {
    return { installed: false, path: null };
  }
}

/** Returns the installed folder when it holds a loadable payload, else null. */
export async function installedExtensionPath(userDataPath: string, expectedCapability?: string | null): Promise<string | null> {
  const state = await browserExtensionInstallState(userDataPath, expectedCapability);
  return state.installed ? state.path : null;
}

/**
 * Open Chrome's extension manager through the fixed internal URL. Chromium
 * may refuse the custom scheme from the operating-system shell; in that case
 * return a bounded error so the renderer can show the exact manual fallback
 * instead of claiming the page opened.
 */
export async function openChromeExtensionsPage(
  openExternal: (url: string) => Promise<void>,
): Promise<BrowserChromeExtensionsResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      openExternal(CHROME_EXTENSIONS_PAGE),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("The browser open request timed out.")), CHROME_OPEN_TIMEOUT_MS);
      }),
    ]);
    return { opened: true, url: CHROME_EXTENSIONS_PAGE, error: null };
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "The browser could not open Chrome's extension manager.";
    return {
      opened: false,
      url: CHROME_EXTENSIONS_PAGE,
      error: message.slice(0, 1_024),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Copy the bundled extension to the stable target, replacing any previous
 * install so stale files never linger, and verify the result actually loads
 * before reporting success.
 */
export async function installBrowserExtension(
  sourceRoot: string,
  userDataPath: string,
  capability: string,
  commitCapability?: () => Promise<void>,
  rollbackCapability?: () => Promise<void>,
): Promise<string> {
  return enqueueInstall(async () => {
    await assertLoadablePayload(sourceRoot, "bundled extension source");
    if (!CAPABILITY_PATTERN.test(capability)) throw new Error("A valid per-install handoff capability is required");

    const target = browserExtensionTarget(userDataPath);
    const parent = path.dirname(target);
    await fsp.mkdir(parent, { recursive: true });
    const temp = path.join(parent, `.${BROWSER_EXTENSION_DIRECTORY_NAME}.stage-${crypto.randomUUID()}`);
    const backup = path.join(parent, `.${BROWSER_EXTENSION_DIRECTORY_NAME}.backup-${crypto.randomUUID()}`);
    let movedExisting = false;
    try {
      await fsp.mkdir(temp, { recursive: true });
      for (const entry of PAYLOAD_ENTRIES) {
        const sourceEntry = path.join(sourceRoot, entry);
        if (!(await isPresent(sourceEntry))) continue;
        await fsp.cp(sourceEntry, path.join(temp, entry), { recursive: true, errorOnExist: true });
      }
      const capabilityModulePath = path.join(temp, CAPABILITY_MODULE);
      await fsp.mkdir(path.dirname(capabilityModulePath), { recursive: true });
      await fsp.writeFile(capabilityModulePath, `// Generated only in the app's private staged extension folder.\nexport const HANDOFF_CAPABILITY = ${JSON.stringify(capability)};\n`, { encoding: "utf8", mode: 0o600 });
      await assertLoadablePayload(temp, "staged extension");

      let targetExists = false;
      try {
        const targetStat = await fsp.lstat(target);
        targetExists = true;
        if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) throw new Error("existing staged extension is redirected or not a directory");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (targetExists) {
        await fsp.rename(target, backup);
        movedExisting = true;
      }
      await fsp.rename(temp, target);
      // Validate the final path before changing the vault. A failed vault
      // write must never leave a new credential paired with an old folder.
      await assertLoadablePayload(target, "installed extension", true);
      if (commitCapability) await commitCapability();
      // Cleanup is deliberately best-effort after the new pairing is durable;
      // a stale private backup must not roll the already-matched pair back.
      if (movedExisting) await fsp.rm(backup, { recursive: true, force: true }).catch(() => undefined);
      return target;
    } catch (error) {
      await fsp.rm(temp, { recursive: true, force: true }).catch(() => undefined);
      if (movedExisting) {
        await fsp.rm(target, { recursive: true, force: true }).catch(() => undefined);
        await fsp.rename(backup, target).catch(() => undefined);
      }
      if (rollbackCapability) await rollbackCapability().catch(() => undefined);
      throw error;
    } finally {
      await fsp.rm(temp, { recursive: true, force: true }).catch(() => undefined);
      await fsp.rm(backup, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
