import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  APP_LOGO_MAX_INPUT_BYTES,
  APP_LOGO_MAX_VARIANT_BYTES,
  APP_LOGO_MAX_VARIANTS,
  cloneAppLogoSettings,
  isAppLogoSettings,
  type AppLogoSettings,
  type AppLogoSnapshot,
} from "../../shared/appLogo";
import { inspectLogoImageBytes } from "./imageInspection";
import { LogoDecoderClient, type LogoDecoderPort, type LogoVariant } from "./LogoDecoderClient";

const CACHE_DIRECTORY_NAME = "logo-customization";
const ACTIVE_MANIFEST_FILE = "active.json";
const SOURCE_FILE_NAME = "source.bin";
const VARIANT_DIRECTORY_NAME = "variants";
const VARIANT_SIZES = [16, 20, 24, 32, 40, 48, 64, 128] as const;
const MANIFEST_MAX_BYTES = 4_096;

type LogoVariantSize = (typeof VARIANT_SIZES)[number];

interface ActiveManifest {
  schemaVersion: 1;
  token: string;
  sourceSha256: string;
  settingsSha256: string;
  variants: Record<string, string>;
}

export interface PreparedLogoVersion {
  readonly token: string;
  readonly settings: AppLogoSettings;
  readonly manifest: ActiveManifest;
  readonly directory: string;
}

export interface PreparedLogoClear {
  readonly backupDirectory: string | null;
}

function sha256(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalSettings(settings: AppLogoSettings): string {
  const normalized = cloneAppLogoSettings(settings);
  return JSON.stringify({
    schemaVersion: normalized.schemaVersion,
    source: normalized.source,
    preset: normalized.preset,
    fit: normalized.fit,
    crop: normalized.crop,
    focalPoint: normalized.focalPoint,
    background: normalized.background,
    backgroundColor: normalized.backgroundColor,
  });
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function hasExactVariantKeys(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = VARIANT_SIZES.map(String).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index] && isSha256(record[key]));
}

function isActiveManifest(value: unknown): value is ActiveManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  return keys.length === 5
    && keys.every((key) => typeof key === "string" && ["schemaVersion", "token", "sourceSha256", "settingsSha256", "variants"].includes(key))
    && record.schemaVersion === 1
    && isToken(record.token)
    && isSha256(record.sourceSha256)
    && isSha256(record.settingsSha256)
    && hasExactVariantKeys(record.variants);
}

function createToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

function isVariantSize(value: number): value is LogoVariantSize {
  return (VARIANT_SIZES as readonly number[]).includes(value);
}

/**
 * Reject a symbolic-link/reparse hop before touching any private cache path.
 * All cache paths are lexically resolved beneath the fixed app-data root.
 */
async function assertSafePath(root: string, target: string, allowMissingLeaf = false): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("The private logo cache path escapes its app-data root.");
  const parts = relative ? relative.split(path.sep) : [];
  let current = resolvedRoot;
  for (let index = -1; index < parts.length; index += 1) {
    if (index >= 0) current = path.join(current, parts[index]);
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("The private logo cache contains an unsafe link.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && (allowMissingLeaf || index < parts.length - 1)) continue;
      throw error;
    }
  }
}

async function removeSafeDirectory(root: string, directory: string): Promise<void> {
  await assertSafePath(root, directory);
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("The private logo cache contains an unsafe link.");
  await fsp.rm(directory, { recursive: true, force: true });
}

async function readBoundedFile(root: string, filePath: string, maximumBytes: number): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof fsp.open>> | null = null;
  try {
    await assertSafePath(root, filePath);
    // Also inspect every existing component from the volume root. A path that
    // merely has a safe immediate parent can still have a reparse ancestor.
    const absolutePath = path.resolve(filePath);
    await assertSafePath(path.parse(absolutePath).root, absolutePath);
    const listed = await fsp.lstat(filePath);
    if (!listed.isFile() || listed.isSymbolicLink() || listed.size < 1 || listed.size > maximumBytes) throw new Error("invalid file");
    handle = await fsp.open(filePath, "r");
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== listed.dev || opened.ino !== listed.ino || opened.size !== listed.size || opened.size < 1 || opened.size > maximumBytes) {
      throw new Error("changed file");
    }
    const output = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < output.length) {
      const { bytesRead } = await handle.read(output, offset, output.length - offset, offset);
      if (bytesRead <= 0) throw new Error("truncated file");
      offset += bytesRead;
    }
    const completed = await handle.stat();
    if (completed.dev !== opened.dev || completed.ino !== opened.ino || completed.size !== opened.size) throw new Error("changed file");
    return output;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function dataUrlFromPng(input: Buffer): string {
  return `data:image/png;base64,${input.toString("base64")}`;
}

function validateDecoderVariants(value: readonly LogoVariant[]): Array<{ size: LogoVariantSize; png: Buffer; digest: string }> {
  if (!Array.isArray(value) || value.length !== APP_LOGO_MAX_VARIANTS) throw new Error("The isolated logo decoder returned an incomplete variant set.");
  const seen = new Set<number>();
  return value.map((variant) => {
    if (!isVariantSize(variant.size) || seen.has(variant.size) || !Buffer.isBuffer(variant.png)) {
      throw new Error("The isolated logo decoder returned an invalid variant.");
    }
    seen.add(variant.size);
    if (variant.png.length < 1 || variant.png.length > APP_LOGO_MAX_VARIANT_BYTES) throw new Error("The isolated logo decoder returned an oversized variant.");
    const inspection = inspectLogoImageBytes(variant.png);
    if (inspection.format !== "png" || inspection.width !== variant.size || inspection.height !== variant.size) {
      throw new Error("The isolated logo decoder returned an invalid rendered image.");
    }
    return { size: variant.size, png: variant.png, digest: sha256(variant.png) };
  });
}

/**
 * A private, app-data-only cache. It never returns original paths, file names,
 * image bytes, cache tokens, or hashes to the renderer, history, export, or
 * settings state. Every mutation is prepared off-line, then atomically
 * activated only after the caller persists its configuration transaction.
 */
export class LogoCustomizationStore {
  private readonly userDataRoot: string;
  private readonly cacheRoot: string;

  constructor(
    userDataPath: string,
    private readonly decoder: LogoDecoderPort = new LogoDecoderClient(),
  ) {
    this.userDataRoot = path.resolve(userDataPath);
    this.cacheRoot = path.resolve(this.userDataRoot, CACHE_DIRECTORY_NAME);
    if (path.dirname(this.cacheRoot) !== this.userDataRoot) throw new Error("The private logo cache path is invalid.");
  }

  private activeManifestPath(): string {
    return path.join(this.cacheRoot, ACTIVE_MANIFEST_FILE);
  }

  private versionDirectory(token: string): string {
    if (!isToken(token)) throw new Error("The private logo cache token is invalid.");
    return path.join(this.cacheRoot, token);
  }

  private async ensureUserDataRoot(): Promise<void> {
    try {
      const stat = await fsp.lstat(this.userDataRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("The app-data root is unsafe.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fsp.mkdir(this.userDataRoot, { recursive: true });
      const created = await fsp.lstat(this.userDataRoot);
      if (!created.isDirectory() || created.isSymbolicLink()) throw new Error("The app-data root is unsafe.");
    }
  }

  private async cacheRootExists(): Promise<boolean> {
    await this.ensureUserDataRoot();
    try {
      await assertSafePath(this.userDataRoot, this.cacheRoot);
      const stat = await fsp.lstat(this.cacheRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("The private logo cache is unsafe.");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async assertPrivatePath(target: string, allowMissingLeaf = false): Promise<void> {
    await this.ensureUserDataRoot();
    await assertSafePath(this.userDataRoot, target, allowMissingLeaf);
  }

  private async ensureCacheRoot(): Promise<void> {
    await this.ensureUserDataRoot();
    await assertSafePath(this.userDataRoot, this.cacheRoot, true);
    try {
      const existing = await fsp.lstat(this.cacheRoot);
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error("The private logo cache is unsafe.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fsp.mkdir(this.cacheRoot);
    }
    await this.assertPrivatePath(this.cacheRoot);
  }

  private async readActiveManifest(): Promise<ActiveManifest | null> {
    try {
      if (!await this.cacheRootExists()) return null;
      const bytes = await readBoundedFile(this.userDataRoot, this.activeManifestPath(), MANIFEST_MAX_BYTES);
      const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      return isActiveManifest(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async writeActiveManifest(manifest: ActiveManifest): Promise<void> {
    await this.ensureCacheRoot();
    const target = this.activeManifestPath();
    const temporary = path.join(this.cacheRoot, `.${createToken()}.manifest`);
    await this.assertPrivatePath(target, true);
    await this.assertPrivatePath(temporary, true);
    try {
      await fsp.writeFile(temporary, JSON.stringify(manifest), { flag: "wx" });
      await this.assertPrivatePath(temporary);
      // Rename is the activation point. Until it succeeds, the old manifest
      // and therefore the old valid logo remain the only active one.
      await fsp.rename(temporary, target);
    } finally {
      await fsp.unlink(temporary).catch(() => undefined);
    }
  }

  private async validateActiveCache(settings: AppLogoSettings): Promise<{ source: Buffer; preview: Buffer } | null> {
    const manifest = await this.readActiveManifest();
    if (!manifest || manifest.settingsSha256 !== sha256(canonicalSettings(settings))) return null;
    try {
      const version = this.versionDirectory(manifest.token);
      await this.assertPrivatePath(version);
      const source = await readBoundedFile(this.userDataRoot, path.join(version, SOURCE_FILE_NAME), APP_LOGO_MAX_INPUT_BYTES);
      inspectLogoImageBytes(source);
      if (sha256(source) !== manifest.sourceSha256) throw new Error("source mismatch");
      let preview: Buffer | null = null;
      for (const size of VARIANT_SIZES) {
        const variantPath = path.join(version, VARIANT_DIRECTORY_NAME, `${size}.png`);
        const variant = await readBoundedFile(this.userDataRoot, variantPath, APP_LOGO_MAX_VARIANT_BYTES);
        const inspection = inspectLogoImageBytes(variant);
        if (inspection.format !== "png" || inspection.width !== size || inspection.height !== size || sha256(variant) !== manifest.variants[String(size)]) {
          throw new Error("variant mismatch");
        }
        if (size === 128) preview = variant;
      }
      if (!preview) throw new Error("missing preview");
      return { source, preview };
    } catch {
      return null;
    }
  }

  private async pruneInactiveVersions(activeToken: string): Promise<void> {
    try {
      if (!await this.cacheRootExists()) return;
      const entries = await fsp.readdir(this.cacheRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!isToken(entry.name) || entry.name === activeToken) continue;
        const candidate = path.join(this.cacheRoot, entry.name);
        await this.assertPrivatePath(candidate);
        const stat = await fsp.lstat(candidate);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        await removeSafeDirectory(this.userDataRoot, candidate);
      }
    } catch {
      // Old opaque cache versions are unreachable. Failure to prune cannot
      // invalidate the newly committed active logo or expose user data.
    }
  }

  private async prepareVersion(sourceBytes: Buffer, settings: AppLogoSettings): Promise<PreparedLogoVersion> {
    inspectLogoImageBytes(sourceBytes);
    const next = cloneAppLogoSettings(settings);
    if (next.source !== "custom") throw new Error("Only a custom logo may prepare private display assets.");
    const decoded = await this.decoder.render(sourceBytes, next);
    const variants = validateDecoderVariants(decoded.variants);
    const token = createToken();
    const staging = path.join(this.cacheRoot, `.${token}.staging`);
    const target = this.versionDirectory(token);
    const manifest: ActiveManifest = {
      schemaVersion: 1,
      token,
      sourceSha256: sha256(sourceBytes),
      settingsSha256: sha256(canonicalSettings(next)),
      variants: Object.fromEntries(variants.map((variant) => [String(variant.size), variant.digest])),
    };
    await this.ensureCacheRoot();
    await this.assertPrivatePath(staging, true);
    await this.assertPrivatePath(target, true);
    try {
      await fsp.mkdir(staging);
      await this.assertPrivatePath(staging);
      const variantDirectory = path.join(staging, VARIANT_DIRECTORY_NAME);
      await fsp.mkdir(variantDirectory);
      await this.assertPrivatePath(variantDirectory);
      await fsp.writeFile(path.join(staging, SOURCE_FILE_NAME), sourceBytes, { flag: "wx" });
      for (const variant of variants) {
        await fsp.writeFile(path.join(variantDirectory, `${variant.size}.png`), variant.png, { flag: "wx" });
      }
      await this.assertPrivatePath(staging);
      await fsp.rename(staging, target);
      return { token, settings: next, manifest, directory: target };
    } catch (error) {
      await removeSafeDirectory(this.userDataRoot, staging).catch(() => undefined);
      await removeSafeDirectory(this.userDataRoot, target).catch(() => undefined);
      throw error;
    }
  }

  async prepareImportFromFile(filePath: string, settings: AppLogoSettings): Promise<PreparedLogoVersion> {
    // The file picker path is main-process-only. It is never persisted or sent
    // across the renderer boundary.
    const selectedPath = path.resolve(filePath);
    if (path.parse(selectedPath).root.startsWith("\\\\")) {
      throw new Error("Choose an image stored on this device; network locations are not used for app-logo conversion.");
    }
    const selectedRoot = path.dirname(selectedPath);
    const source = await readBoundedFile(selectedRoot, selectedPath, APP_LOGO_MAX_INPUT_BYTES);
    return this.prepareVersion(source, { ...settings, source: "custom" });
  }

  async prepareUpdate(previousSettings: AppLogoSettings, settings: AppLogoSettings): Promise<PreparedLogoVersion> {
    const next = cloneAppLogoSettings(settings);
    if (next.source !== "custom") throw new Error("A preset logo does not need private conversion.");
    const current = await this.validateActiveCache(previousSettings);
    if (!current) throw new Error("The previous valid local logo is unavailable; choose the local image again before changing its rendering.");
    return this.prepareVersion(current.source, next);
  }

  async commitPrepared(prepared: PreparedLogoVersion): Promise<void> {
    if (!isAppLogoSettings(prepared.settings) || prepared.settings.source !== "custom" || !isActiveManifest(prepared.manifest)
      || prepared.directory !== this.versionDirectory(prepared.token) || prepared.manifest.token !== prepared.token
      || prepared.manifest.settingsSha256 !== sha256(canonicalSettings(prepared.settings))) {
      throw new Error("The prepared local logo is invalid.");
    }
    await this.assertPrivatePath(prepared.directory);
    await this.writeActiveManifest(prepared.manifest);
    await this.pruneInactiveVersions(prepared.token);
  }

  async discardPrepared(prepared: PreparedLogoVersion): Promise<void> {
    try {
      const manifest = await this.readActiveManifest();
      if (manifest?.token === prepared.token) return;
      await removeSafeDirectory(this.userDataRoot, prepared.directory);
    } catch {
      // A stale staging directory is private, unreachable, and never active.
    }
  }

  async prepareClear(): Promise<PreparedLogoClear> {
    if (!await this.cacheRootExists()) return { backupDirectory: null };
    const backupDirectory = `${this.cacheRoot}.clear-${createToken()}`;
    try {
      await this.assertPrivatePath(backupDirectory, true);
      await fsp.rename(this.cacheRoot, backupDirectory);
      await this.assertPrivatePath(backupDirectory);
      return { backupDirectory };
    } catch {
      throw new Error("The private logo cache could not be prepared for reset.");
    }
  }

  async commitClear(prepared: PreparedLogoClear): Promise<void> {
    if (!prepared.backupDirectory) return;
    await removeSafeDirectory(this.userDataRoot, prepared.backupDirectory);
  }

  async rollbackClear(prepared: PreparedLogoClear): Promise<void> {
    if (!prepared.backupDirectory) return;
    try {
      const exists = await fsp.lstat(prepared.backupDirectory).then(() => true, () => false);
      if (exists) {
        await this.assertPrivatePath(prepared.backupDirectory);
        await this.assertPrivatePath(this.cacheRoot, true);
        await fsp.rename(prepared.backupDirectory, this.cacheRoot);
      }
    } catch {
      throw new Error("The previous private logo cache could not be restored safely.");
    }
  }

  async getSnapshot(settings: AppLogoSettings): Promise<AppLogoSnapshot> {
    const next = cloneAppLogoSettings(settings);
    if (next.source !== "custom") {
      return { settings: next, activeSource: "preset", previewDataUrl: null, status: "ready" };
    }
    const current = await this.validateActiveCache(next);
    return current
      ? { settings: next, activeSource: "custom", previewDataUrl: dataUrlFromPng(current.preview), status: "ready" }
      : { settings: next, activeSource: "preset", previewDataUrl: null, status: "custom-cache-missing" };
  }
}

export { inspectLogoImageBytes } from "./imageInspection";
