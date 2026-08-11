#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CHILD_OUTPUT = 16_384;
const RUNTIME_CHECK_IDS = [
  "resolve-cdp-page",
  "cdp-connected",
  "renderer-root-mounted",
  "feature-surface-mounted",
  "tab-strip-no-overlap",
  "tab-search-builders",
  "history-panel",
  "history-action-error-separation",
  "changelog-action-error-separation",
  "progress-window",
  "settings-open",
  "settings-scheduled-settings",
  "settings-authenticator-surface",
  "settings-authenticator-live-management",
  "settings-dialog-a11y",
  "settings-auto-organize-ui",
  "settings-auto-organize-regex-focus",
  "settings-auto-organize-contrast",
  "settings-auto-organize-invalid-save",
  "settings-auto-organize-save-persistence",
  "settings-auto-organize-search-targets",
  "settings-narrow-layout",
  "settings-auto-organize-narrow-bilingual",
  "settings-tabs",
  "settings-search-control",
  "settings-search-interaction",
  "settings-regex-builder",
  "escape-closes-builder-and-restores-focus",
  "settings-browser-extension-install-and-reveal",
  "settings-browser-extension-manual-reveal",
  "settings-dialog-escape",
  "settings-auto-organize-command-palette",
  "settings-auto-organize-preview-ipc",
  "settings-reset-provenance",
];
const GALLERY_ITEMS = [
  { name: "01-six-category-paths", selector: "#settings-panel-downloads" },
  { name: "02-ordered-rule-editor", selector: "#settings-auto-organize-rules" },
  { name: "03-anchored-regex-builder", selector: ".auto-organize-rule-builder" },
  { name: "04-inline-invalid-rule", selector: "#settings-auto-organize-rules" },
  { name: "05-narrow-rule-layout", selector: ".auto-organize-rule-builder" },
  { name: "06-bilingual-category-settings", selector: "#settings-panel-downloads" },
  { name: "07-command-palette-destination", selector: ".command-palette" },
];

function usage() {
  return [
    "Dependency-free real Electron UI smoke harness",
    "",
    "Usage:",
    "  node design/ui-tests/smoke.mjs [options]",
    "",
    "Options:",
    "  --app-dir <path>       Built Electron app directory (default: design)",
    "  --electron <path>      Electron executable (default: app-dir/node_modules/electron/dist)",
    "  --port <number>        CDP port; 0 chooses a free loopback port",
    "  --timeout <ms>         Per-run timeout (default: 30000)",
    "  --temp-root <path>     Parent for the disposable app profile (default: OS temp directory)",
    "  --screenshot <path>    Capture a PNG of the installed browser-extension card after automatic folder reveal",
    "  --scheduled-screenshot <path>  Capture the built Settings scheduled-settings surface",
    "  --authenticator-screenshot <path>  Capture the secret-free Authenticator Settings registration surface",
    "  --progress-screenshot <path>  Capture a separate progress page when one exists",
    "  --gallery-dir <path>    Capture the seven auto-organize documentation states into this directory",
    "  --json <path>          Write the same stable JSON summary to a file",
    "  --keep-user-data-dir   Preserve the temporary Electron profile for debugging",
    "  --help                 Show this help",
    "",
    "The harness requires Node 22+, the built renderer/main output, and a local",
    "Electron executable. It uses child_process, fetch, global WebSocket, and CDP",
    "only; it does not use a browser automation package or visible UI controls.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    appDirectory: DEFAULT_APP_DIRECTORY,
    electronPath: null,
    port: 0,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    tempRoot: null,
    screenshotPath: null,
    scheduledScreenshotPath: null,
    authenticatorScreenshotPath: null,
    progressScreenshotPath: null,
    galleryDirectory: null,
    jsonPath: null,
    keepUserDataDirectory: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true, options };
    if (argument === "--keep-user-data-dir") {
      options.keepUserDataDirectory = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    index += 1;

    if (argument === "--app-dir") options.appDirectory = path.resolve(value);
    else if (argument === "--electron") options.electronPath = path.resolve(value);
    else if (argument === "--port") options.port = parseBoundedInteger(value, "port", 0, 65_535);
    else if (argument === "--timeout") options.timeoutMs = parseBoundedInteger(value, "timeout", 1_000, 300_000);
    else if (argument === "--temp-root") options.tempRoot = path.resolve(value);
    else if (argument === "--screenshot") options.screenshotPath = path.resolve(value);
    else if (argument === "--scheduled-screenshot") options.scheduledScreenshotPath = path.resolve(value);
    else if (argument === "--authenticator-screenshot") options.authenticatorScreenshotPath = path.resolve(value);
    else if (argument === "--progress-screenshot") options.progressScreenshotPath = path.resolve(value);
    else if (argument === "--gallery-dir") options.galleryDirectory = path.resolve(value);
    else if (argument === "--json") options.jsonPath = path.resolve(value);
    else throw new Error(`Unknown option: ${argument}`);
  }

  return { help: false, options };
}

function parseBoundedInteger(value, label, minimum, maximum) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requireNonEmptyFile(filePath, label) {
  let fileInfo;
  try {
    fileInfo = await stat(filePath);
  } catch {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  if (!fileInfo.isFile() || fileInfo.size === 0) throw new Error(`${label} is empty or not a file: ${filePath}`);
  return { path: filePath, bytes: fileInfo.size, modifiedAtMs: fileInfo.mtimeMs };
}

async function collectFiles(rootDirectory, includeFile) {
  const results = [];
  let entries;
  try {
    entries = await readdir(rootDirectory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`source directory is unavailable: ${rootDirectory} (${formatError(error)})`);
  }

  for (const entry of entries) {
    const entryPath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      results.push(...(await collectFiles(entryPath, includeFile)));
    } else if (entry.isFile() && includeFile(entryPath)) {
      const fileInfo = await stat(entryPath);
      results.push({ path: entryPath, modifiedAtMs: fileInfo.mtimeMs });
    }
  }
  return results;
}

function sourceFileExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

function newestFile(files) {
  return files.reduce((newest, file) => (!newest || file.modifiedAtMs > newest.modifiedAtMs ? file : newest), null);
}

function oldestFile(files) {
  return files.reduce((oldest, file) => (!oldest || file.modifiedAtMs < oldest.modifiedAtMs ? file : oldest), null);
}

async function inspectBuildFreshness(appDirectory, rendererArtifacts) {
  const rendererRootSourceFiles = await Promise.all(
    ["index.html", "vite.config.ts"].map((name) =>
      requireNonEmptyFile(path.join(appDirectory, name), `renderer source ${name}`)
    )
  );
  const rendererSourceFiles = [
    ...(await collectFiles(path.join(appDirectory, "src"), (filePath) => [".ts", ".tsx", ".css"].includes(sourceFileExtension(filePath)))),
    ...(await collectFiles(path.join(appDirectory, "shared"), (filePath) => sourceFileExtension(filePath) === ".ts")),
    ...rendererRootSourceFiles,
  ];
  const mainSourceFiles = [
    ...(await collectFiles(path.join(appDirectory, "electron"), (filePath) => sourceFileExtension(filePath) === ".ts")),
    ...(await collectFiles(path.join(appDirectory, "shared"), (filePath) => sourceFileExtension(filePath) === ".ts")),
    ...(await collectFiles(path.join(appDirectory, "electron"), (filePath) => path.basename(filePath) === "tsconfig.json")),
  ];
  const mainArtifactFiles = await collectFiles(
    path.join(appDirectory, "dist-electron"),
    (filePath) => sourceFileExtension(filePath) === ".js" && !filePath.split(path.sep).includes("__tests__")
  );

  if (rendererSourceFiles.length === 0) throw new Error("no renderer source files were found for freshness verification");
  if (mainSourceFiles.length === 0) throw new Error("no Electron source files were found for freshness verification");
  if (mainArtifactFiles.length === 0) throw new Error("no compiled Electron JavaScript files were found for freshness verification");

  const newestRendererSource = newestFile(rendererSourceFiles);
  const oldestRendererArtifact = oldestFile(rendererArtifacts);
  const newestMainSource = newestFile(mainSourceFiles);
  const oldestMainArtifact = oldestFile(mainArtifactFiles);
  if (!oldestRendererArtifact || oldestRendererArtifact.modifiedAtMs < newestRendererSource.modifiedAtMs) {
    throw new Error(`built renderer is stale: newest source ${path.relative(appDirectory, newestRendererSource.path)} is newer than renderer output ${oldestRendererArtifact ? path.relative(appDirectory, oldestRendererArtifact.path) : "<missing>"}`);
  }
  if (!oldestMainArtifact || oldestMainArtifact.modifiedAtMs < newestMainSource.modifiedAtMs) {
    throw new Error(`built Electron artifact is stale: newest source ${path.relative(appDirectory, newestMainSource.path)} is newer than compiled output ${oldestMainArtifact ? path.relative(appDirectory, oldestMainArtifact.path) : "<missing>"}`);
  }

  return {
    renderer: {
      sourceCount: rendererSourceFiles.length,
      artifactCount: rendererArtifacts.length,
      newestSource: path.relative(appDirectory, newestRendererSource.path),
      newestSourceModifiedAtMs: newestRendererSource.modifiedAtMs,
      oldestArtifact: path.relative(appDirectory, oldestRendererArtifact.path),
      oldestArtifactModifiedAtMs: oldestRendererArtifact.modifiedAtMs,
      stale: false,
    },
    electron: {
      sourceCount: mainSourceFiles.length,
      artifactCount: mainArtifactFiles.length,
      newestSource: path.relative(appDirectory, newestMainSource.path),
      newestSourceModifiedAtMs: newestMainSource.modifiedAtMs,
      oldestArtifact: path.relative(appDirectory, oldestMainArtifact.path),
      oldestArtifactModifiedAtMs: oldestMainArtifact.modifiedAtMs,
      stale: false,
    },
  };
}

function defaultElectronPath(appDirectory) {
  const executableName = process.platform === "win32" ? "electron.exe" : "electron";
  return path.join(appDirectory, "node_modules", "electron", "dist", executableName);
}

async function inspectBuildOutput(appDirectory, explicitElectronPath) {
  const packagePath = path.join(appDirectory, "package.json");
  await requireNonEmptyFile(packagePath, "app package manifest");

  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  } catch (error) {
    throw new Error(`app package manifest is not valid JSON: ${formatError(error)}`);
  }

  if (typeof packageJson.main !== "string" || packageJson.main.length === 0) {
    throw new Error("app package manifest has no usable main entry");
  }

  const rendererIndexPath = path.join(appDirectory, "dist", "index.html");
  const mainEntryPath = path.resolve(appDirectory, packageJson.main);
  const preloadPath = path.join(appDirectory, "dist-electron", "electron", "preload.js");
  const electronPath = explicitElectronPath ?? defaultElectronPath(appDirectory);

  const files = {
    package: await requireNonEmptyFile(packagePath, "app package manifest"),
    rendererIndex: await requireNonEmptyFile(rendererIndexPath, "built renderer index"),
    mainEntry: await requireNonEmptyFile(mainEntryPath, "built Electron main entry"),
    preload: await requireNonEmptyFile(preloadPath, "built Electron preload entry"),
    electron: await requireNonEmptyFile(electronPath, "local Electron executable"),
  };

  const rendererHtml = await readFile(rendererIndexPath, "utf8");
  const assetReferences = [...rendererHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((reference) => !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(reference));

  if (assetReferences.length === 0) throw new Error("built renderer index has no local asset reference");
  const assets = [];
  for (const reference of assetReferences) {
    const relativeReference = reference.replace(/^\/+/, "");
    const assetPath = path.resolve(appDirectory, "dist", relativeReference);
    assets.push(await requireNonEmptyFile(assetPath, `built renderer asset ${reference}`));
  }

  const freshness = await inspectBuildFreshness(appDirectory, [files.rendererIndex, ...assets]);
  return {
    appDirectory,
    electronPath,
    mainEntry: path.relative(appDirectory, mainEntryPath),
    files,
    assets,
    freshness,
    productName: typeof packageJson.productName === "string" ? packageJson.productName : packageJson.name ?? "Electron app",
  };
}

async function allocateLoopbackPort(requestedPort) {
  if (requestedPort !== 0) return requestedPort;

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not allocate a loopback port"));
        else resolve(port);
      });
    });
  });
}

async function startFixtureServer() {
  const body = Buffer.alloc(256 * 1024, 0x61);
  const requests = [];
  const timers = new Set();
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({ method: request.method ?? "", path: requestUrl.pathname, receivedAt: new Date().toISOString() });
    if (requestUrl.pathname !== "/ui-smoke.bin" || !["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-length": body.length,
      "content-type": "application/octet-stream",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    let offset = 0;
    let activeTimer = null;
    const sendChunk = () => {
      if (response.destroyed) return;
      if (offset >= body.length) {
        response.end();
        return;
      }
      const nextOffset = Math.min(offset + 16 * 1024, body.length);
      response.write(body.subarray(offset, nextOffset));
      offset = nextOffset;
      activeTimer = setTimeout(() => {
        if (activeTimer) timers.delete(activeTimer);
        sendChunk();
      }, 10);
      timers.add(activeTimer);
    };
    response.once("close", () => {
      if (activeTimer) {
        clearTimeout(activeTimer);
        timers.delete(activeTimer);
      }
    });
    sendChunk();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  if (!port) {
    await new Promise((resolve) => server.close(() => resolve()));
    throw new Error("Could not start the progress-window fixture server");
  }
  let closePromise = null;
  return {
    url: ["http://127.0.0.1:", String(port), "/ui-smoke.bin"].join(""),
    requests,
    waitForRequest: async (timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const request = requests.find((candidate) => candidate.method === "GET" && candidate.path === "/ui-smoke.bin");
        if (request) return request;
        await sleep(25);
      }
      return null;
    },
    close: (timeoutMs = 3_000) => {
      if (closePromise) return closePromise;
      closePromise = new Promise((resolve, reject) => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        const timeout = setTimeout(() => reject(new Error("fixture server did not close within the cleanup timeout")), timeoutMs);
        server.close((error) => {
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve({ closed: true });
        });
      });
      return closePromise;
    },
  };
}

function appendChildOutput(current, chunk) {
  const next = `${current}${chunk}`;
  return next.length <= MAX_CHILD_OUTPUT ? next : next.slice(next.length - MAX_CHILD_OUTPUT);
}

function spawnBuiltApp(build, userDataDirectory, port) {
  const argumentsForElectron = [
    build.appDirectory,
    `--user-data-dir=${userDataDirectory}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--disable-gpu",
  ];
  if (process.platform !== "win32") argumentsForElectron.push("--no-sandbox");

  const environment = { ...process.env, NODE_ENV: "production", MDM_HISTORY_ACCESS_SCOPE: "ui-smoke" };
  delete environment.ELECTRON_RUN_AS_NODE;

  const child = spawn(build.electronPath, argumentsForElectron, {
    cwd: build.appDirectory,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  let spawnError = null;
  child.stdout?.on("data", (chunk) => {
    stdout = appendChildOutput(stdout, chunk.toString());
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendChildOutput(stderr, chunk.toString());
  });
  child.once("error", (error) => {
    spawnError = formatError(error);
  });

  const exit = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ code: null, signal: null, error: formatError(error) }));
  });

  return {
    child,
    arguments: argumentsForElectron,
    getOutput: () => ({ stdout, stderr, error: spawnError }),
    exit,
  };
}

async function clearSmokeHistoryAccess(appDirectory) {
  const modulePath = path.join(appDirectory, "dist-electron", "electron", "history", "HistoryAccessVault.js");
  const module = await import(pathToFileURL(modulePath).href);
  await new module.HistoryAccessVault().remove();
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function listCdpTargets(port) {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`, 2_000);
  if (!Array.isArray(targets)) throw new Error("CDP /json/list response was not an array");
  return targets;
}

async function resolvePageTarget(port, timeoutMs, getProcessState) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "CDP target list is not available yet";

  while (Date.now() < deadline) {
    const processState = getProcessState();
    if (processState.error || (processState.code !== undefined && processState.code !== null)) {
      const output = processState.output;
      throw new Error(`Electron exited before exposing a CDP page (code ${processState.code}, signal ${processState.signal ?? "none"})${processState.error ? `: ${processState.error}` : output.stderr ? `: ${output.stderr.trim()}` : ""}`);
    }

    try {
      const targets = await listCdpTargets(port);
      const page = targets.find(
        (target) => target && target.type === "page" && typeof target.webSocketDebuggerUrl === "string" && !String(target.url).startsWith("devtools://")
      );
      if (page) return page;
      lastError = "CDP is reachable but no page target has a WebSocket URL yet";
    } catch (error) {
      lastError = formatError(error);
    }
    await sleep(100);
  }

  throw new Error(`Timed out resolving a dynamic CDP page target after ${timeoutMs}ms: ${lastError}`);
}

function derivedProgressScreenshotPath(options) {
  if (options.progressScreenshotPath) return options.progressScreenshotPath;
  if (!options.screenshotPath) return null;
  const parsed = path.parse(options.screenshotPath);
  return path.join(parsed.dir, `${parsed.name}-progress${parsed.ext || ".png"}`);
}

async function inspectProgressWindow(port, mainTargetId, timeoutMs, screenshotPath, expectedItemId, expectedFileName, expectedUrl) {
  let targets;
  try {
    targets = await listCdpTargets(port);
  } catch (error) {
    return { status: "unavailable", target: null, surface: null, screenshotPath: null, candidates: [], detail: formatError(error) };
  }
  const separatePages = targets.filter(
    (target) => target && target.type === "page" && target.id !== mainTargetId && typeof target.webSocketDebuggerUrl === "string"
  );
  const inspectedTargets = [];

  for (const target of separatePages) {
    const candidate = {
      id: target.id ?? null,
      title: target.title ?? null,
      url: target.url ?? null,
    };
    let secondaryClient = null;
    try {
      secondaryClient = new CdpClient(target.webSocketDebuggerUrl, timeoutMs);
      await secondaryClient.connect();
      await secondaryClient.send("Runtime.enable");
      await secondaryClient.send("Page.enable");
      const surface = await secondaryClient.evaluate([
        "(() => {",
        "const query = new URLSearchParams(window.location.search);",
        "const root = document.querySelector('[data-surface=\"progress-window\"]');",
        "const heading = document.querySelector('#progress-window-heading');",
        "const sourceUrl = document.querySelector('.progress-url');",
        "const progressBars = [...document.querySelectorAll('[role=\"progressbar\"]')].map((element) => ({",
        "  name: element.getAttribute('aria-label') || element.getAttribute('aria-valuetext') || element.textContent?.replace(/\\s+/g, ' ').trim() || '',",
        "  valueNow: element.getAttribute('aria-valuenow'),",
        "}));",
        "return {",
        "  readyState: document.readyState,",
        "  progressItem: query.get('progressItem'),",
        "  dataSurface: root?.getAttribute('data-surface') ?? null,",
        "  heading: heading?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,",
        "  sourceUrl: sourceUrl?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,",
        "  progressBarCount: progressBars.length,",
        "  progressBars,",
        "};",
        "})()",
      ].join("\n"));
      if (surface.progressItem !== expectedItemId) continue;
      inspectedTargets.push({ ...candidate, surface });
      if (surface.readyState !== "complete" || surface.dataSurface !== "progress-window") {
        return { status: "loading", target: candidate, surface, screenshotPath: null, candidates: inspectedTargets };
      }
      if (surface.heading !== expectedFileName) throw new Error("progress window heading is " + JSON.stringify(surface.heading) + ", expected " + JSON.stringify(expectedFileName));
      if (surface.sourceUrl !== expectedUrl) throw new Error("progress window source URL does not match the seeded fixture URL");
      if (surface.progressBarCount === 0) throw new Error("separate progress-looking page has no role=progressbar");
      if (surface.progressBars.some((bar) => !bar.name)) throw new Error("separate progress page has an unnamed progressbar");
      let capturedPath = null;
      if (screenshotPath) capturedPath = await captureScreenshot(secondaryClient, screenshotPath);
      return {
        status: "checked",
        target: candidate,
        surface,
        screenshotPath: capturedPath,
        candidates: inspectedTargets,
      };
    } catch (error) {
      if (target.url?.includes(expectedItemId) || inspectedTargets.length > 0) {
        return { status: "failed", target: candidate, detail: formatError(error), candidates: inspectedTargets };
      }
    } finally {
      if (secondaryClient) await secondaryClient.close();
    }
  }

  return {
    status: "not-present",
    target: null,
    surface: null,
    screenshotPath: null,
    candidates: inspectedTargets,
  };
}

class CdpClient {
  constructor(webSocketUrl, timeoutMs) {
    this.webSocketUrl = webSocketUrl;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
  }

  async connect() {
    if (typeof globalThis.WebSocket !== "function") throw new Error("global WebSocket is unavailable");

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.webSocketUrl);
      this.socket = socket;
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          // The socket may already be gone; the timeout error is the useful evidence.
        }
        reject(new Error(`Timed out opening the CDP WebSocket after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      socket.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      });
      socket.addEventListener("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error("CDP WebSocket failed to open"));
      });
      socket.addEventListener("message", (event) => {
        void this.handleMessage(event.data);
      });
      socket.addEventListener("close", () => {
        const error = new Error("CDP WebSocket closed");
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(error);
        }
        this.pending.clear();
      });
    });
  }

  async handleMessage(data) {
    let text;
    if (typeof data === "string") text = data;
    else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString("utf8");
    else if (data && typeof data.text === "function") text = await data.text();
    else text = String(data);

    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message.id !== "number") return;

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) pending.reject(new Error(`CDP ${pending.method} failed: ${message.error.message ?? JSON.stringify(message.error)}`));
    else pending.resolve(message.result ?? {});
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== 1) throw new Error("CDP WebSocket is not open");
    const id = ++this.nextId;
    const message = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timeout });
      this.socket.send(message);
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      const description = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "page evaluation failed";
      throw new Error(description);
    }
    return response.result?.value;
  }

  async close() {
    if (!this.socket) return;
    try {
      this.socket.close();
    } catch {
      // Cleanup is best effort after the process is already owned by this harness.
    }
    this.socket = null;
  }
}

async function waitForPage(client, expression, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "condition was false";
  while (Date.now() < deadline) {
    try {
      if (await client.evaluate(expression)) return;
    } catch (error) {
      lastError = formatError(error);
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms: ${lastError}`);
}

const PAGE_A11Y_HELPERS = String.raw`
  function normalise(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }
  function accessibleName(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return normalise(ariaLabel);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelledText = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      if (normalise(labelledText)) return normalise(labelledText);
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const labelText = element.labels?.[0]?.textContent;
      if (normalise(labelText)) return normalise(labelText);
      return normalise(element.getAttribute("placeholder"));
    }
    return normalise(element.textContent);
  }
  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    return !element.hidden && style.display !== "none" && style.visibility !== "hidden";
  }
  function findByRole(role, name, root = document) {
    const selector = role === "button" ? "button,[role=button]" : "[role=\"" + role + "\"]";
    return [...root.querySelectorAll(selector)].find((element) => isVisible(element) && accessibleName(element) === name) ?? null;
  }
  function contrastRatio(foreground, background) {
    function channels(value) {
      const parts = String(value).match(/[0-9.]+/g)?.slice(0, 3).map(Number);
      if (!parts || parts.length !== 3) throw new Error("Cannot parse computed color " + JSON.stringify(value));
      return parts.map((part) => {
        const channel = part / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    }
    const foregroundChannels = channels(foreground);
    const backgroundChannels = channels(background);
    const foregroundLuminance = 0.2126 * foregroundChannels[0] + 0.7152 * foregroundChannels[1] + 0.0722 * foregroundChannels[2];
    const backgroundLuminance = 0.2126 * backgroundChannels[0] + 0.7152 * backgroundChannels[1] + 0.0722 * backgroundChannels[2];
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }
`;

function pageExpression(body) {
  return `(() => { ${PAGE_A11Y_HELPERS} ${body} })()`;
}

function pageSelector(value) {
  return JSON.stringify(value);
}

async function clickByRole(client, role, name, rootSelector = null) {
  const root = rootSelector ? `document.querySelector(${pageSelector(rootSelector)})` : "document";
  const result = await client.evaluate(pageExpression(`
    const root = ${root};
    if (!root) throw new Error("Accessible control root was not found");
    const control = findByRole(${JSON.stringify(role)}, ${JSON.stringify(name)}, root);
    if (!control) throw new Error(${JSON.stringify(`${role} named ${name} was not found`)});
    control.focus();
    control.click();
    return { name: accessibleName(control), tag: control.tagName.toLowerCase() };
  `));
  return result;
}

async function setInputValue(client, selector, value) {
  await client.evaluate(`(() => {
    const element = document.querySelector(${pageSelector(selector)});
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("Input control was not found");
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter is unavailable");
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.focus();
    return element.value;
  })()`);
}

async function setSelectValue(client, selector, value) {
  await client.evaluate(`(() => {
    const element = document.querySelector(${pageSelector(selector)});
    if (!(element instanceof HTMLSelectElement)) throw new Error("Select control was not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (!setter) throw new Error("Select value setter is unavailable");
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.focus();
    return element.value;
  })()`);
}

async function dispatchKey(client, key, code, virtualKeyCode) {
  const text = key === "Enter" ? "\r" : key === " " ? " " : "";
  await client.send("Input.dispatchKeyEvent", {
    type: text ? "keyDown" : "rawKeyDown",
    key,
    code,
    text,
    unmodifiedText: text,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
}

async function dispatchEscape(client) {
  await dispatchKey(client, "Escape", "Escape", 27);
}

async function captureScreenshot(client, screenshotPath, selector = null) {
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  let clip;
  if (selector) {
    const bounds = await client.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) throw new Error("Screenshot target is missing");
      const box = element.getBoundingClientRect();
      const padding = 24;
      const x = Math.max(0, box.left - padding);
      const y = Math.max(0, box.top - padding);
      const right = Math.min(window.innerWidth, box.right + padding);
      const bottom = Math.min(window.innerHeight, box.bottom + padding);
      if (right <= x || bottom <= y) throw new Error("Screenshot target has empty bounds");
      return { x, y, width: right - x, height: bottom - y, scale: 1 };
    })()`);
    clip = bounds;
  }
  const response = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    ...(clip ? { clip } : {}),
  });
  if (typeof response.data !== "string" || response.data.length === 0) throw new Error("CDP returned no screenshot data");
  await writeFile(screenshotPath, Buffer.from(response.data, "base64"));
  await requireNonEmptyFile(screenshotPath, "captured screenshot");
  return screenshotPath;
}

async function captureGalleryFrame(client, options, result, name, selector) {
  if (!options.galleryDirectory) return null;
  const target = path.join(options.galleryDirectory, `${name}.png`);
  await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) throw new Error("Gallery target is missing: " + ${JSON.stringify(selector)});
    element.scrollIntoView({ block: "center", inline: "nearest" });
  })()`);
  await sleep(60);
  const capturedPath = await captureScreenshot(client, target);
  result.gallery.items.push({ name, selector, path: capturedPath, status: "captured" });
  return capturedPath;
}

function createResult(options) {
  return {
    schemaVersion: 1,
    status: "failed",
    exitCode: 1,
    harness: "design/ui-tests/smoke.mjs",
    node: process.version,
    platform: process.platform,
    appDirectory: options.appDirectory,
    timeoutMs: options.timeoutMs,
    checks: [],
    screenshot: options.screenshotPath ? { requested: true, status: "not-run", path: options.screenshotPath } : { requested: false, status: "not-requested", path: null },
    scheduled: options.scheduledScreenshotPath
      ? { requested: true, status: "not-run", path: options.scheduledScreenshotPath }
      : { requested: false, status: "not-requested", path: null },
    authenticator: options.authenticatorScreenshotPath
      ? { requested: true, status: "not-run", path: options.authenticatorScreenshotPath }
      : { requested: false, status: "not-requested", path: null },
    gallery: options.galleryDirectory
      ? { requested: true, status: "not-run", directory: options.galleryDirectory, expected: GALLERY_ITEMS.map((item) => item.name), items: [] }
      : { requested: false, status: "not-requested", directory: null, expected: [], items: [] },
    progressWindow: { status: "not-run", target: null, surface: null, screenshotPath: null },
    launch: null,
    cdp: null,
    cleanup: { processTerminated: false, fixtureServerClosed: false, userDataDirectoryRemoved: false },
    fatalError: null,
    durationMs: 0,
    summary: "",
  };
}

function hasCheck(result, id) {
  return result.checks.some((check) => check.id === id);
}

function recordCheck(result, id, status, detail, data = undefined) {
  if (hasCheck(result, id)) return;
  const check = { id, status, detail };
  if (data !== undefined) check.data = data;
  result.checks.push(check);
}

async function runCheck(result, id, operation) {
  try {
    const outcome = await operation();
    recordCheck(result, id, "passed", "verified", outcome);
    return outcome;
  } catch (error) {
    recordCheck(result, id, "failed", formatError(error));
    return null;
  }
}

function markRuntimeChecksFailed(result, reason) {
  for (const id of RUNTIME_CHECK_IDS) recordCheck(result, id, "failed", `not run because ${reason}`);
}

function makeSummary(result) {
  const passed = result.checks.filter((check) => check.status === "passed").length;
  const failed = result.checks.filter((check) => check.status === "failed").length;
  return `${result.status.toUpperCase()}: ${passed} passed, ${failed} failed; ${result.checks.length} required checks recorded`;
}

async function listWindowsProcessesByMarker(marker) {
  const script = [
    "$marker = $env:MDM_SMOKE_PROCESS_MARKER",
    "$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object ProcessId, ParentProcessId, Name)",
    "$processes | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, MDM_SMOKE_PROCESS_MARKER: marker },
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
    name: String(row.Name ?? ""),
  })).filter((row) => Number.isSafeInteger(row.pid) && row.pid > 0);
}

async function terminateWindowsProcessTree(pid) {
  await new Promise((resolve) => {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
  });
}

async function waitForWindowsMarkerExit(marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let processes = await listWindowsProcessesByMarker(marker);
  while (processes.length > 0 && Date.now() < deadline) {
    await sleep(100);
    processes = await listWindowsProcessesByMarker(marker);
  }
  return processes;
}

async function stopProcess(launch, timeoutMs, processMarker) {
  if (!launch) return { terminated: true, method: "not-started", exit: null };

  if (process.platform === "win32" && processMarker) {
    try {
      const observed = await listWindowsProcessesByMarker(processMarker);
      const mainPid = launch.child.pid ?? null;
      if (mainPid && launch.child.exitCode === null && launch.child.signalCode === null) {
        await terminateWindowsProcessTree(mainPid);
      } else {
        for (const processInfo of observed) await terminateWindowsProcessTree(processInfo.pid);
      }
      const exited = await Promise.race([
        launch.exit.then((value) => ({ done: true, value })),
        sleep(Math.min(timeoutMs, 3_000)).then(() => ({ done: false })),
      ]);
      let survivors = await waitForWindowsMarkerExit(processMarker, Math.min(timeoutMs, 3_000));
      if (survivors.length > 0) {
        for (const processInfo of survivors) await terminateWindowsProcessTree(processInfo.pid);
        survivors = await waitForWindowsMarkerExit(processMarker, Math.min(timeoutMs, 3_000));
      }
      return {
        terminated: survivors.length === 0,
        method: "verified-tree",
        exit: exited.done ? exited.value : null,
        evidence: {
          mainPid,
          childExitObserved: exited.done,
          observedProcessIds: observed.map((processInfo) => processInfo.pid),
          survivingProcessIds: survivors.map((processInfo) => processInfo.pid),
          marker: processMarker,
        },
      };
    } catch (error) {
      return {
        terminated: false,
        method: "tree-verification-failed",
        exit: null,
        evidence: { marker: processMarker, error: formatError(error) },
      };
    }
  }

  const alreadyExited = launch.child.exitCode !== null || launch.child.signalCode !== null;
  if (alreadyExited) return { terminated: true, method: "already-exited", exit: await launch.exit };

  launch.child.kill("SIGTERM");
  let exited = await Promise.race([launch.exit.then((value) => ({ done: true, value })), sleep(Math.min(timeoutMs, 3_000)).then(() => ({ done: false }))]);
  if (!exited.done) {
    if (process.platform === "win32" && launch.child.pid) {
      await new Promise((resolve) => {
        execFile("taskkill", ["/PID", String(launch.child.pid), "/T", "/F"], { windowsHide: true }, () => resolve());
      });
    } else {
      launch.child.kill("SIGKILL");
    }
    exited = await Promise.race([launch.exit.then((value) => ({ done: true, value })), sleep(Math.min(timeoutMs, 3_000)).then(() => ({ done: false }))]);
  }

  return exited.done
    ? { terminated: true, method: "graceful-or-tree", exit: exited.value }
    : { terminated: false, method: "timeout", exit: null };
}

async function removeDirectoryWithRetry(directory, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw lastError ?? new Error("temporary directory removal timed out");
}

async function main(argv) {
  const startedAt = Date.now();
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n\n${usage()}\n`);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const { options } = parsed;
  process.env.MDM_HISTORY_ACCESS_SCOPE = "ui-smoke";
  const result = createResult(options);
  const captureGallery = async (name, selector) => captureGalleryFrame(cdp, options, result, name, selector);
  let build = null;
  let launch = null;
  let cdp = null;
  let userDataDirectory = null;
  let port = null;
  let fixtureServer = null;

  try {
    const nodeRuntime = await runCheck(result, "node-runtime", async () => {
      const major = Number(process.versions.node.split(".")[0]);
      if (!Number.isInteger(major) || major < 22) throw new Error(`Node 22+ is required; found ${process.version}`);
      return { major, version: process.version };
    });
    const runtimeCapabilities = await runCheck(result, "harness-runtime-capabilities", async () => {
      if (typeof globalThis.fetch !== "function") throw new Error("global fetch is unavailable");
      if (typeof globalThis.WebSocket !== "function") throw new Error("global WebSocket is unavailable");
      return { fetch: "available", webSocket: "available" };
    });
    if (!nodeRuntime || !runtimeCapabilities) throw new Error("Node or required global runtime capability is unavailable");

    build = await runCheck(result, "build-output", () => inspectBuildOutput(options.appDirectory, options.electronPath));
    if (!build) throw new Error("build-output check failed; refusing to launch an unverified, missing, or stale build");
    await clearSmokeHistoryAccess(options.appDirectory);

    port = await allocateLoopbackPort(options.port);
    const tempRoot = options.tempRoot ?? os.tmpdir();
    await mkdir(tempRoot, { recursive: true });
    userDataDirectory = await mkdtemp(path.join(tempRoot, "material-download-manager-ui-smoke-"));
    const launchEvidence = await runCheck(result, "launch-built-electron", async () => {
      launch = spawnBuiltApp(build, userDataDirectory, port);
      if (!launch.child.pid) throw new Error("Electron child process did not expose a PID");
      result.launch = {
        pid: launch.child.pid,
        executable: build.electronPath,
        arguments: launch.arguments,
        userDataDirectory,
        cdpPort: port,
      };
      return {
        pid: launch.child.pid,
        executable: build.electronPath,
        arguments: launch.arguments,
        cdpPort: port,
      };
    });
    if (!launchEvidence || !launch) throw new Error("Electron launch check failed");

    const targetEvidence = await runCheck(result, "resolve-cdp-page", async () => {
      const target = await resolvePageTarget(port, options.timeoutMs, () => ({
        code: launch.child.exitCode,
        signal: launch.child.signalCode,
        error: launch.getOutput().error,
        output: launch.getOutput(),
      }));
      result.cdp = {
        port,
        target: {
          id: target.id ?? null,
          type: target.type ?? null,
          title: target.title ?? null,
          url: target.url ?? null,
        },
      };
      return result.cdp;
    });
    if (!targetEvidence) {
      markRuntimeChecksFailed(result, "a dynamic CDP page target was not resolved");
      throw new Error("CDP page target resolution failed");
    }

    cdp = new CdpClient((await listCdpTargets(port)).find((target) => target?.id === targetEvidence.target.id)?.webSocketDebuggerUrl ?? "", options.timeoutMs);
    const cdpConnected = await runCheck(result, "cdp-connected", async () => {
      if (!cdp.webSocketUrl) throw new Error("resolved CDP target did not expose a WebSocket URL");
      await cdp.connect();
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      return { webSocket: "connected", targetId: targetEvidence.target.id };
    });
    if (!cdpConnected) {
      markRuntimeChecksFailed(result, "the CDP WebSocket did not connect");
      throw new Error("CDP WebSocket connection failed");
    }

    await runCheck(result, "renderer-root-mounted", async () => {
      await waitForPage(
        cdp,
        `document.readyState === "complete" && Boolean(document.querySelector("#root")?.firstElementChild) && typeof window.api === "object"`,
        "the built renderer root and preload bridge",
        options.timeoutMs
      );
      return cdp.evaluate(pageExpression(`
        const root = document.querySelector("#root");
        if (!root?.firstElementChild) throw new Error("#root has no mounted renderer content");
        if (typeof window.api !== "object") throw new Error("preload bridge window.api is not mounted");
        return { rootChildren: root.children.length, preloadBridge: true };
      `));
    });

    await runCheck(result, "progress-window", async () => {
      fixtureServer = await startFixtureServer();
      const seeded = await cdp.evaluate(`(async () => {
        const settings = await window.api.getSettings();
        const itemId = await window.api.addDownload({
           url: ${JSON.stringify(fixtureServer.url)},
          folder: ${JSON.stringify(path.join(userDataDirectory, "downloads"))},
          fileName: "ui-smoke.bin",
          startImmediately: false,
          headers: {},
        });
         const opened = await window.api.openProgressWindow(itemId);
         if (!opened) throw new Error("main process refused to open the seeded progress window");
         await window.api.resumeDownload(itemId);
         return { itemId, fileName: "ui-smoke.bin", url: ${JSON.stringify(fixtureServer.url)}, opened };
      })()`);
      const fixtureRequest = await fixtureServer.waitForRequest(options.timeoutMs);
      if (!fixtureRequest) throw new Error("the seeded download never issued a GET request to the loopback fixture");
      if (fixtureRequest.path !== "/ui-smoke.bin") throw new Error("the seeded download requested an unexpected fixture path");
      const deadline = Date.now() + options.timeoutMs;
      let progressWindow = null;
      while (Date.now() < deadline) {
        progressWindow = await inspectProgressWindow(
          port,
          targetEvidence.target.id,
          options.timeoutMs,
          derivedProgressScreenshotPath(options),
          seeded.itemId,
          seeded.fileName,
          seeded.url
        );
        const pageFinishedLoading = progressWindow.status === "failed" && progressWindow.surface?.readyState === "complete";
        if (progressWindow.status === "checked" || pageFinishedLoading) break;
        await sleep(100);
      }
      result.progressWindow = progressWindow;
      if (!progressWindow || progressWindow.status !== "checked") {
        throw new Error(`separate progress window was not verified: ${JSON.stringify(progressWindow)}`);
      }
      return { seeded, fixtureRequest, ...progressWindow };
    });

    await runCheck(result, "feature-surface-mounted", async () => cdp.evaluate(pageExpression(`
      const root = document.querySelector("#root");
      if (!root?.firstElementChild) throw new Error("renderer surface is not mounted");
      const tabList = document.querySelector('[role="tablist"][aria-label="Open tabs"]');
      const settingsButton = findByRole("button", "Settings");
      const toolbarSearch = document.querySelector('input[aria-label="Search downloads"]');
      if (!tabList && (!settingsButton || !toolbarSearch)) throw new Error("neither TabStrip nor the implemented toolbar/Settings surface is mounted");
      let tabs = [];
      if (tabList) {
        tabs = [...tabList.querySelectorAll('[role="tab"]')].map((tab) => ({ name: accessibleName(tab), selected: tab.getAttribute("aria-selected") }));
        if (tabs.length === 0) throw new Error("mounted TabStrip has no role=tab children");
        if (tabs.some((tab) => !tab.name || (tab.selected !== "true" && tab.selected !== "false"))) throw new Error("mounted TabStrip has an unnamed or state-less tab");
      }
      return { tabStripMounted: Boolean(tabList), tabs, fallbackSurface: tabList ? null : "toolbar + Settings" };
    `)));

    await runCheck(result, "tab-strip-no-overlap", async () => cdp.evaluate(pageExpression(`
      const strip = document.querySelector('[role="tablist"][aria-label="Open tabs"]');
      if (!strip) throw new Error("Open tabs strip is missing");
      const controls = [...strip.querySelectorAll(".app-tab,.tab-search-toggle,.tab-group-toggle,.tab-group-action")]
        .filter(isVisible)
        .map((control) => ({ control, name: accessibleName(control), box: control.getBoundingClientRect() }));
      const overlaps = [];
      for (let left = 0; left < controls.length; left += 1) {
        for (let right = left + 1; right < controls.length; right += 1) {
          const a = controls[left];
          const b = controls[right];
          const width = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
          const height = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
          if (width > 1 && height > 1) overlaps.push({ first: a.name, second: b.name, width, height });
        }
      }
      if (overlaps.length > 0) throw new Error("tab strip controls overlap: " + JSON.stringify(overlaps.slice(0, 8)));
      return { controls: controls.length, overlaps: 0, scrollable: strip.scrollWidth > strip.clientWidth };
    `)));

    await runCheck(result, "tab-search-builders", async () => {
      await clickByRole(cdp, "button", "Search tabs", '[role="tablist"][aria-label="Open tabs"]');
      await waitForPage(cdp, `document.querySelectorAll(".tab-search-control").length === 4`, "four tab discovery searches", options.timeoutMs);
      const toggles = await cdp.evaluate(pageExpression(`
        const buttons = [...document.querySelectorAll(".tab-search-control .tab-search-input-row button")].filter(isVisible);
        const names = buttons.map(accessibleName);
        if (buttons.length !== 4 || new Set(names).size !== 4) throw new Error("tab discovery Regex toggles are not four unique controls: " + JSON.stringify(names));
        return names;
      `));

      await clickByRole(cdp, "button", "Current tab strip regex builder", ".tab-search-control");
      await waitForPage(cdp, `Boolean(document.querySelector(".tab-search-control .regex-builder"))`, "current-strip regex builder", options.timeoutMs);
      await cdp.evaluate(pageExpression(`
        const control = document.querySelectorAll(".tab-search-control")[0];
        const regexMode = [...control.querySelectorAll('.regex-builder input[type="radio"]')].find((input) => /Regular expression/.test(accessibleName(input)));
        if (!(regexMode instanceof HTMLInputElement)) throw new Error("current-strip builder has no Regex mode");
        regexMode.click();
      `));
      await setInputValue(cdp, 'input[aria-label="Current tab strip search"]', "[");
      await waitForPage(cdp, `Boolean(document.querySelectorAll(".tab-search-control")[0]?.querySelector('.field-error[role="alert"]'))`, "tab-search invalid-regex alert", options.timeoutMs);
      await setInputValue(cdp, 'input[aria-label="Current tab strip search"]', "zzzz-no-tab-result");
      await waitForPage(cdp, `Boolean(document.querySelectorAll(".tab-search-control")[0]?.querySelector('.tab-search-empty[role="status"]'))`, "tab-search settled no-match status", options.timeoutMs);
      const states = await cdp.evaluate(pageExpression(`
        const control = document.querySelectorAll(".tab-search-control")[0];
        const empty = control?.querySelector('.tab-search-empty[role="status"]');
        if (!(empty instanceof HTMLElement) || !/No current tab strip results match/.test(empty.textContent ?? "")) throw new Error("tab-search no-match status is missing or vague");
        return { invalidAlert: true, noMatch: empty.textContent?.trim() ?? "" };
      `));
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelectorAll(".tab-search-control")[0]?.querySelector(".regex-builder") && document.activeElement?.getAttribute("aria-label") === "Current tab strip regex builder"`, "tab builder Escape focus", options.timeoutMs);

      await clickByRole(cdp, "button", "Current tab strip regex builder", ".tab-search-panel");
      await clickByRole(cdp, "button", "Current tab group regex builder", ".tab-search-panel");
      await waitForPage(cdp, `document.querySelectorAll(".tab-search-control .regex-builder").length === 2`, "two independently open tab builders", options.timeoutMs);
      const uniqueness = await cdp.evaluate(pageExpression(`
        const controls = [...document.querySelectorAll(".tab-search-control .regex-builder input,.tab-search-control .regex-builder textarea,.tab-search-control .regex-builder button")].filter(isVisible);
        const names = controls.map(accessibleName);
        const blanks = names.filter((name) => !name);
        const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
        if (blanks.length || duplicates.length) throw new Error("simultaneous tab builders have blank/duplicate control names: " + JSON.stringify({ blanks, duplicates }));
        return { visibleBuilders: 2, interactiveControls: names.length, uniqueNames: names.length };
      `));
      await cdp.evaluate(`document.querySelectorAll(".tab-search-control")[1]?.querySelector(".regex-pattern")?.focus()`);
      await dispatchEscape(cdp);
      await waitForPage(
        cdp,
        `document.querySelectorAll(".tab-search-control .regex-builder").length === 1 && document.activeElement?.getAttribute("aria-label") === "Current tab group regex builder"`,
        "close second simultaneous tab builder and restore focus",
        options.timeoutMs
      );
      await cdp.evaluate(`document.querySelectorAll(".tab-search-control")[0]?.querySelector(".regex-pattern")?.focus()`);
      await dispatchEscape(cdp);
      await waitForPage(
        cdp,
        `document.querySelectorAll(".tab-search-control .regex-builder").length === 0 && document.activeElement?.getAttribute("aria-label") === "Current tab strip regex builder"`,
        "close simultaneous tab builders",
        options.timeoutMs
      );

      await clickByRole(cdp, "button", "New group", '[role="tablist"][aria-label="Open tabs"]');
      await waitForPage(cdp, `Boolean(document.querySelector('.tab-group-picker[role="dialog"]'))`, "tab group picker", options.timeoutMs);
      await clickByRole(cdp, "button", "Search groups regex builder", ".tab-group-picker");
      await waitForPage(cdp, `Boolean(document.querySelector(".tab-group-picker .regex-builder"))`, "group-picker regex builder", options.timeoutMs);
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelector(".tab-group-picker .regex-builder") && document.activeElement?.getAttribute("aria-label") === "Search groups regex builder"`, "group-picker builder Escape focus", options.timeoutMs);
      await clickByRole(cdp, "button", "Close", ".tab-group-picker");

      await cdp.evaluate(pageExpression(`
        const tab = findByRole("tab", "Downloads", document.querySelector('[role="tablist"][aria-label="Open tabs"]'));
        if (!(tab instanceof HTMLElement)) throw new Error("Downloads tab is unavailable for context-menu search");
        tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 180, clientY: 40 }));
      `));
      await waitForPage(cdp, `Boolean(document.querySelector('.tab-context-menu[role="menu"]'))`, "tab context menu", options.timeoutMs);
      await clickByRole(cdp, "button", "Search tab actions regex builder", ".tab-context-menu");
      await waitForPage(cdp, `Boolean(document.querySelector(".tab-context-menu .regex-builder"))`, "tab-context regex builder", options.timeoutMs);
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelector(".tab-context-menu .regex-builder") && document.activeElement?.getAttribute("aria-label") === "Search tab actions regex builder"`, "tab-context builder Escape focus", options.timeoutMs);
      await clickByRole(cdp, "button", "Close", ".tab-context-menu");

      await clickByRole(cdp, "button", "Search tabs", '[role="tablist"][aria-label="Open tabs"]');
      await waitForPage(cdp, `!document.querySelector(".tab-search-panel")`, "close tab discovery searches", options.timeoutMs);
      return { toggles, states, uniqueness, groupPickerBuilder: true, contextMenuBuilder: true, escapeFocus: true };
    });

    await runCheck(result, "documentation-panel", async () => {
      await clickByRole(cdp, "tab", "Documentation");
      await waitForPage(cdp, `Boolean(document.querySelector("#documentation-panel-heading"))`, "Documentation tab surface", options.timeoutMs);
      const initial = await cdp.evaluate(pageExpression(`
        const panel = document.querySelector(".documentation-panel");
        const search = document.querySelector('input[aria-label="Search documentation articles"]');
        const articleButtons = document.querySelectorAll(".documentation-article-list button");
        const activeTab = document.querySelector('[role="tablist"][aria-label="Open tabs"] [role="tab"][aria-selected="true"]');
        const article = document.querySelector(".documentation-article");
        if (!panel || !isVisible(panel) || !search || !isVisible(search)) throw new Error("Documentation panel or search is missing or hidden");
        if (articleButtons.length === 0) throw new Error("Documentation article index is empty");
        if (!article || !isVisible(article) || !article.querySelector(".documentation-markdown")) throw new Error("Documentation article renderer is missing");
        if (!activeTab || accessibleName(activeTab) !== "Documentation") throw new Error("Documentation tab is not active");
        return { articleCount: articleButtons.length, search: accessibleName(search), activeTab: accessibleName(activeTab), rendered: true };
      `));

      await setInputValue(cdp, 'input[aria-label="Search documentation articles"]', "progress window");
      await waitForPage(cdp, `document.querySelectorAll(".documentation-article-list button").length > 0 && /progress window/i.test(document.querySelector(".documentation-article-list")?.textContent ?? "")`, "Documentation article search", options.timeoutMs);
      await cdp.evaluate(pageExpression(`
        const button = [...document.querySelectorAll(".documentation-article-list button")].find((candidate) => /progress window/i.test(candidate.textContent ?? ""));
        if (!(button instanceof HTMLElement)) throw new Error("Progress-window article search result is missing");
        button.click();
      `));
      await waitForPage(cdp, `/Separate download progress window/i.test(document.querySelector(".documentation-article-header")?.textContent ?? "")`, "selected Documentation article", options.timeoutMs);

      const linkTarget = await cdp.evaluate(pageExpression(`
        const link = [...document.querySelectorAll(".documentation-markdown a")].find((candidate) => /Renderer accessibility/i.test(candidate.textContent ?? ""));
        if (!(link instanceof HTMLAnchorElement)) throw new Error("Rendered article is missing its relative Renderer accessibility link");
        link.click();
        return link.textContent?.trim() ?? "";
      `));
      await waitForPage(cdp, `/Renderer accessibility bridge/i.test(document.querySelector(".documentation-article-header")?.textContent ?? "")`, "relative Documentation article link", options.timeoutMs);

      await clickByRole(cdp, "button", "Regex", ".documentation-search");
      await waitForPage(cdp, `Boolean(document.querySelector('#documentation-search-builder section[aria-label$="regex builder"]'))`, "Documentation regex builder", options.timeoutMs);
      await setInputValue(cdp, ".documentation-search .regex-pattern", "documentation|regex");
      await waitForPage(cdp, `document.querySelectorAll(".documentation-article-list button").length > 0`, "Documentation regex results", options.timeoutMs);
      const regexEvidence = await cdp.evaluate(pageExpression(`
        const builder = document.querySelector("#documentation-search-builder section[aria-label$='regex builder']");
        const resultCount = document.querySelectorAll(".documentation-article-list button").length;
        if (!builder || !isVisible(builder)) throw new Error("Documentation regex builder is not visible");
        if (resultCount === 0) throw new Error("Documentation regex search returned no result");
        return { builder: true, resultCount, relativeLink: ${JSON.stringify(linkTarget)} };
      `));

      await setInputValue(cdp, 'input[aria-label="Search documentation articles"]', "no-such-bundled-article");
      await waitForPage(cdp, `Boolean(document.querySelector(".documentation-index .documentation-empty"))`, "Documentation honest empty state", options.timeoutMs);
      const empty = await cdp.evaluate(pageExpression(`
        const emptyState = document.querySelector(".documentation-index .documentation-empty");
        if (!emptyState || !isVisible(emptyState)) throw new Error("Documentation empty state is missing or hidden");
        return emptyState.textContent?.replace(/\\s+/g, " ").trim() ?? "";
      `));
      await setInputValue(cdp, 'input[aria-label="Search documentation articles"]', "");
      return { ...initial, relativeLink: linkTarget, regex: regexEvidence, emptyState: empty };
    });

    await runCheck(result, "documentation-command-palette", async () => {
      await cdp.evaluate(pageExpression(`
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, shiftKey: true, bubbles: true }));
      `));
      await waitForPage(cdp, `Boolean(document.querySelector('[role="dialog"].command-palette'))`, "command palette from Ctrl+Shift+F", options.timeoutMs);
      await setInputValue(cdp, 'input[aria-label="Command palette search"]', "Documentation");
      await waitForPage(cdp, `Boolean([...document.querySelectorAll(".command-palette-row")].find((row) => /Documentation/i.test(row.textContent ?? "")))`, "Documentation command-palette result", options.timeoutMs);
      const evidence = await cdp.evaluate(pageExpression(`
        const row = [...document.querySelectorAll(".command-palette-row")].find((candidate) => /Documentation/i.test(candidate.textContent ?? ""));
        if (!(row instanceof HTMLElement)) throw new Error("Documentation command-palette result is missing");
        return { result: accessibleName(row), shortcut: "Ctrl+Shift+F" };
      `));
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelector('[role="dialog"].command-palette')`, "command palette close", options.timeoutMs);
      return evidence;
    });

    await runCheck(result, "history-panel", async () => {
      await clickByRole(cdp, "tab", "History");
      await waitForPage(cdp, `Boolean(document.querySelector("#history-panel-heading"))`, "History tab surface", options.timeoutMs);
      await waitForPage(cdp, `Boolean(document.querySelector(".history-access, .history-filters"))`, "History protection state", options.timeoutMs);
      if (await cdp.evaluate(`Boolean(document.querySelector("form.history-access"))`)) {
        const smokeHistoryPassword = "smoke-history-password-2026";
        const setupState = await cdp.evaluate(`window.api.setupHistoryAccess(${JSON.stringify(smokeHistoryPassword)})`);
        if (!setupState?.configured || !setupState?.unlocked) throw new Error(`History setup returned an unexpected state: ${JSON.stringify(setupState)}`);
        await cdp.evaluate("location.reload()");
        await waitForPage(cdp, `Boolean(document.querySelector("#history-panel-heading"))`, "reloaded History tab", options.timeoutMs);
        await clickByRole(cdp, "tab", "History");
        await waitForPage(cdp, `Boolean(document.querySelector("form.history-access, .history-filters"))`, "configured History state", options.timeoutMs);
        if (await cdp.evaluate(`Boolean(document.querySelector("form.history-access"))`)) {
          await setInputValue(cdp, 'form.history-access input[type="password"]', smokeHistoryPassword);
          await clickByRole(cdp, "button", "Unlock history", "form.history-access");
          await waitForPage(cdp, `Boolean(document.querySelector('input[aria-label="Search history"]'))`, "unlocked History search", options.timeoutMs);
        }
      }
      const evidence = await cdp.evaluate(pageExpression(`
        const panel = document.querySelector(".history-panel");
        const search = document.querySelector('input[aria-label="Search history"]');
        const dates = document.querySelectorAll('.history-panel input[type="date"]');
        const exportButton = findByRole("button", "Export filtered history");
        const tab = document.querySelector('[role="tablist"][aria-label="Open tabs"] [role="tab"][aria-selected="true"]');
        if (!panel || !isVisible(panel) || !search || !isVisible(search)) {
          throw new Error("History panel or search is missing or hidden");
        }
        if (dates.length !== 2) throw new Error("History panel is missing its two native date filters");
        if (!exportButton) throw new Error("History panel is missing its export action");
        if (!tab || accessibleName(tab) !== "History") throw new Error("History tab is not the active application tab");
        const results = document.querySelector(".history-results");
        const status = document.querySelector(".history-empty, .history-status-error");
        if (!results && !status) throw new Error("History panel did not expose a loaded result or an honest status state");
        return { search: accessibleName(search), datePickers: dates.length, export: accessibleName(exportButton), activeTab: accessibleName(tab), loadedState: results ? "results" : "status" };
      `));
      await clickByRole(cdp, "tab", "Downloads");
      await waitForPage(cdp, `document.querySelector('[role="tablist"][aria-label="Open tabs"] [role="tab"][aria-selected="true"]')?.textContent?.trim() === "Downloads"`, "return to Downloads tab", options.timeoutMs);
      return evidence;
    });

    await runCheck(result, "history-action-error-separation", async () => {
      await clickByRole(cdp, "tab", "History");
      await waitForPage(cdp, `Boolean(document.querySelector("#history-panel-heading")) && !document.querySelector(".history-empty[role=status]")`, "loaded History action surface", options.timeoutMs);
      await setSelectValue(cdp, ".history-format-field select", "");
      await clickByRole(cdp, "button", "Export filtered history");
      await waitForPage(cdp, `Boolean(document.querySelector("#history-export-error"))`, "History export action error", options.timeoutMs);
      const failure = await cdp.evaluate(pageExpression(`
        const search = document.querySelector('input[aria-label="Search history"]');
        const actionError = document.getElementById("history-export-error");
        const filterError = document.getElementById("history-filter-error");
        const retry = findByRole("button", "Retry history export", actionError ?? document);
        if (!(search instanceof HTMLInputElement) || !actionError || !retry) throw new Error("History action error or retry control is missing");
        if (search.getAttribute("aria-invalid") === "true") throw new Error("History export failure incorrectly marks search invalid");
        if (search.getAttribute("aria-describedby") === "history-export-error") throw new Error("History search is described by an action failure");
        if (filterError) throw new Error("History export failure incorrectly rendered as a filter failure");
        return { searchInvalid: false, actionAlert: actionError.textContent?.replace(/\\s+/g, " ").trim(), retry: accessibleName(retry) };
      `));
      await setSelectValue(cdp, ".history-format-field select", "jsonl");
      await clickByRole(cdp, "button", "Retry history export", "#history-export-error");
      await waitForPage(cdp, `!document.querySelector("#history-export-error") && /Exported .* revision records/i.test(document.querySelector('.history-status[role="status"]')?.textContent ?? "")`, "successful History export retry", options.timeoutMs);
      const recovery = await cdp.evaluate(pageExpression(`
        const status = document.querySelector('.history-status[role="status"]');
        if (!status) throw new Error("History export success status is missing after retry");
        return status.textContent?.replace(/\\s+/g, " ").trim() ?? "";
      `));
      await clickByRole(cdp, "tab", "Downloads");
      return { failure, recovery };
    });

    await runCheck(result, "changelog-action-error-separation", async () => {
      await clickByRole(cdp, "tab", "Changelog");
      await waitForPage(cdp, `Boolean(document.querySelector("#changelog-panel-heading")) && !document.querySelector(".changelog-empty[role=status]")`, "loaded Changelog action surface", options.timeoutMs);
      await setSelectValue(cdp, 'select[aria-label="Changelog export format"]', "");
      await clickByRole(cdp, "button", "Export filtered");
      await waitForPage(cdp, `Boolean(document.querySelector("#changelog-action-error"))`, "Changelog export action error", options.timeoutMs);
      const failure = await cdp.evaluate(pageExpression(`
        const search = document.querySelector('input[aria-label="Search changelog"]');
        const actionError = document.getElementById("changelog-action-error");
        const filterError = document.getElementById("changelog-filter-error");
        const retry = findByRole("button", "Retry changelog export", actionError ?? document);
        if (!(search instanceof HTMLInputElement) || !actionError || !retry) throw new Error("Changelog action error or retry control is missing");
        if (search.getAttribute("aria-invalid") === "true") throw new Error("Changelog export failure incorrectly marks search invalid");
        if (search.getAttribute("aria-describedby") === "changelog-action-error") throw new Error("Changelog search is described by an action failure");
        if (filterError) throw new Error("Changelog export failure incorrectly rendered as a filter failure");
        return { searchInvalid: false, actionAlert: actionError.textContent?.replace(/\\s+/g, " ").trim(), retry: accessibleName(retry) };
      `));
      await setSelectValue(cdp, 'select[aria-label="Changelog export format"]', "markdown");
      await clickByRole(cdp, "button", "Retry changelog export", "#changelog-action-error");
      await waitForPage(cdp, `!document.querySelector("#changelog-action-error") && /Exported .* filtered release records/i.test(document.querySelector('.changelog-status[role="status"]')?.textContent ?? "")`, "successful Changelog export retry", options.timeoutMs);
      const recovery = await cdp.evaluate(pageExpression(`
        const status = document.querySelector('.changelog-status[role="status"]');
        if (!status) throw new Error("Changelog export success status is missing after retry");
        return status.textContent?.replace(/\\s+/g, " ").trim() ?? "";
      `));
      await clickByRole(cdp, "tab", "Downloads");
      return { failure, recovery };
    });

    await runCheck(result, "settings-open", async () => {
      await clickByRole(cdp, "button", "Settings");
      await waitForPage(cdp, `Boolean(document.querySelector(".dialog"))`, "Settings dialog surface", options.timeoutMs);
      if (options.galleryDirectory) await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
      return cdp.evaluate(pageExpression(`
        const dialog = document.querySelector(".dialog");
        if (!dialog || !isVisible(dialog)) throw new Error("Settings dialog is not visible after activating Settings");
        return { className: dialog.className, visible: true };
      `));
    });

    await runCheck(result, "settings-scheduled-settings", async () => {
      await clickByRole(cdp, "tab", "Downloads", '[role="dialog"]');
      await waitForPage(cdp, `Boolean(document.querySelector("#settings-scheduled-settings"))`, "scheduled settings surface", options.timeoutMs);
      await clickByRole(cdp, "button", "Add schedule", "#settings-scheduled-settings");
      await waitForPage(cdp, `document.querySelectorAll('#settings-scheduled-settings input[type="date"]').length === 2`, "native scheduled date controls", options.timeoutMs);
      const evidence = await cdp.evaluate(pageExpression(`
        const panel = document.getElementById("settings-scheduled-settings");
        const add = findByRole("button", "Add schedule", panel ?? document);
        const save = findByRole("button", "Save schedules", panel ?? document);
        const nativeDates = panel?.querySelectorAll('input[type="date"]') ?? [];
        const nativeTimes = panel?.querySelectorAll('input[type="time"]') ?? [];
        const timezone = panel?.querySelector('select');
        if (!(panel instanceof HTMLElement) || !isVisible(panel)) throw new Error("Scheduled settings panel is missing or hidden");
        if (!add || !save || nativeDates.length !== 2 || nativeTimes.length !== 2 || !timezone) {
          throw new Error("Scheduled settings editor controls are incomplete after adding a record");
        }
        return { panel: true, add: accessibleName(add), save: accessibleName(save), emptyState: Boolean(panel.querySelector('[role="status"]')) };
      `));
      if (options.scheduledScreenshotPath) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
        const capturedPath = await captureScreenshot(cdp, options.scheduledScreenshotPath, "#settings-scheduled-settings");
        result.scheduled = { requested: true, status: "captured", path: capturedPath };
        return { ...evidence, screenshotPath: capturedPath };
      }
      return evidence;
    });

    await runCheck(result, "settings-authenticator-surface", async () => {
      await clickByRole(cdp, "tab", "Authenticator", '[role="dialog"]');
      await waitForPage(cdp, `Boolean(document.querySelector("#settings-authenticator-panel"))`, "Authenticator Settings panel", options.timeoutMs);
      const evidence = await cdp.evaluate(pageExpression(`
        const panel = document.getElementById("settings-authenticator-panel");
        const controls = [
          "authenticator-issuer",
          "authenticator-account",
          "authenticator-secret",
          "authenticator-algorithm",
          "authenticator-digits",
          "authenticator-period",
          "authenticator-prepare-qr",
          "authenticator-list-search",
          "authenticator-export",
        ].map((id) => document.getElementById(id));
        if (!(panel instanceof HTMLElement) || !isVisible(panel)) throw new Error("Authenticator Settings panel is missing or hidden");
        if (controls.some((control) => !(control instanceof HTMLElement) || !isVisible(control))) throw new Error("Authenticator registration/list control is missing or hidden");
        if (document.querySelector("#authenticator-pairing-code")) throw new Error("secret-bearing pairing confirmation is visible before an explicit QR preparation action");
        if ((panel.textContent ?? "").includes("otpauth://")) throw new Error("ordinary Authenticator surface exposed an otpauth URI");
        if ((document.getElementById("authenticator-secret") instanceof HTMLInputElement) && document.getElementById("authenticator-secret").value) throw new Error("fresh Authenticator surface unexpectedly contains a secret");
        const activeTab = document.querySelector('[role="tablist"][aria-label="Settings sections"] [role="tab"][aria-selected="true"]');
        if (!activeTab || accessibleName(activeTab) !== "Authenticator") throw new Error("Authenticator tab is not active");
        return { activeTab: accessibleName(activeTab), registrationControls: controls.length, pairingHidden: true, uriExposed: false, secretPresent: false };
      `));
      if (options.authenticatorScreenshotPath) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
        const capturedPath = await captureScreenshot(cdp, options.authenticatorScreenshotPath, "#settings-authenticator-panel .authenticator-card");
        result.authenticator = { requested: true, status: "captured", path: capturedPath };
        return { ...evidence, screenshotPath: capturedPath };
      }
      return evidence;
    });

    await runCheck(result, "settings-authenticator-live-management", async () => {
      const registration = await cdp.evaluate(pageExpression(`return (async () => {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        const bytes = crypto.getRandomValues(new Uint8Array(20));
        let buffer = 0;
        let bits = 0;
        let secret = "";
        for (const byte of bytes) {
          buffer = (buffer << 8) | byte;
          bits += 8;
          while (bits >= 5) {
            bits -= 5;
            secret += alphabet[(buffer >>> bits) & 31];
          }
        }
        if (bits > 0) secret += alphabet[(buffer << (5 - bits)) & 31];
        const metadata = await window.api.registerAuthenticator({
          issuer: "Smoke Authenticator",
          account: "smoke@local.test",
          secret,
          algorithm: "SHA1",
          digits: 6,
          period: 30,
        });
        const key = "material-download-manager.authenticator.metadata.v1";
        localStorage.setItem(key, JSON.stringify([metadata]));
        return { id: metadata.id, digits: metadata.digits };
      })()`));
      try {
        await cdp.evaluate("location.reload()");
        await waitForPage(cdp, `Boolean(document.querySelector("#root > *"))`, "reloaded app for authenticator management", options.timeoutMs);
        await clickByRole(cdp, "button", "Settings");
        await waitForPage(cdp, `Boolean(document.querySelector('[role="dialog"]'))`, "reloaded Settings dialog", options.timeoutMs);
        await clickByRole(cdp, "tab", "Authenticator", '[role="dialog"]');
        await waitForPage(cdp, `Boolean(document.querySelector("#settings-authenticator-panel"))`, "reloaded Authenticator panel", options.timeoutMs);
        const evidence = await cdp.evaluate(pageExpression(`(() => {
          const row = document.querySelector('[data-authenticator-code-id="${registration.id}"]');
          const current = document.getElementById("authenticator-current-code-${registration.id}");
          const next = document.getElementById("authenticator-next-code-${registration.id}");
          const countdown = document.getElementById("authenticator-countdown-${registration.id}");
          const copy = document.getElementById("authenticator-copy-${registration.id}");
          if (!(row instanceof HTMLElement) || !isVisible(row)) throw new Error("live authenticator row is missing or hidden");
          if (!(current instanceof HTMLElement) || !/^\\d{6}$/.test(current.textContent?.trim() ?? "")) throw new Error("current authenticator code is not a six-digit value");
          if (!(next instanceof HTMLElement) || !/^\\d{6}$/.test(next.textContent?.trim() ?? "")) throw new Error("next authenticator code is not a six-digit value");
          if (!(countdown instanceof HTMLElement) || !/^\\d+s (?:remaining|剩餘)$/.test(countdown.textContent?.trim() ?? "")) throw new Error("numeric authenticator countdown is missing");
          if (!(copy instanceof HTMLButtonElement) || !isVisible(copy) || copy.disabled) throw new Error("current-code copy action is unavailable");
          return { row: true, currentDigits: current.textContent?.trim().length, nextDigits: next.textContent?.trim().length, countdown: countdown.textContent?.trim(), copy: accessibleName(copy) };
        })()`));
        return { ...evidence, metadataId: registration.id, persistedMetadata: true, secretReturned: false };
      } finally {
        await cdp.evaluate(pageExpression(`(async () => {
          const key = "material-download-manager.authenticator.metadata.v1";
          const raw = localStorage.getItem(key);
          const records = raw ? JSON.parse(raw) : [];
          const target = Array.isArray(records) ? records.find((record) => record?.id === ${JSON.stringify(registration.id)}) : null;
          if (target) await window.api.removeAuthenticator(target);
          localStorage.removeItem(key);
        })()`)).catch(() => {});
      }
    });
    await clickByRole(cdp, "tab", "Downloads", '[role="dialog"]');

    await runCheck(result, "settings-dialog-a11y", async () => cdp.evaluate(pageExpression(`
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) throw new Error('Settings surface is mounted but missing required role="dialog"');
      const name = accessibleName(dialog);
      if (name !== "Settings") throw new Error("Settings dialog accessible name is " + JSON.stringify(name) + ', not "Settings"');
      const nestedInteractiveLabels = [...dialog.querySelectorAll("label")].flatMap((label) => [...label.querySelectorAll("button,[role=button]")].map((control) => ({
        label: label.textContent?.replace(/\\s+/g, " ").trim() ?? "",
        control: accessibleName(control),
      })));
      if (nestedInteractiveLabels.length > 0) throw new Error("Settings contains interactive controls nested inside labels: " + JSON.stringify(nestedInteractiveLabels));
      const unnamedControls = [...dialog.querySelectorAll("input,select,textarea,button")]
        .filter(isVisible)
        .map((control) => ({ tag: control.tagName.toLowerCase(), id: control.id, name: accessibleName(control) }))
        .filter((control) => !control.name);
      if (unnamedControls.length > 0) throw new Error("Settings contains unnamed interactive controls: " + JSON.stringify(unnamedControls));
      return { role: "dialog", name, nestedInteractiveLabels: 0, unnamedControls: 0 };
    `)));

    await runCheck(result, "settings-auto-organize-ui", async () => {
      await clickByRole(cdp, "tab", "Downloads", '[role="dialog"]');
      await waitForPage(cdp, `Boolean(document.querySelector("#settings-auto-organize-toggle"))`, "auto-organize settings surface", options.timeoutMs);
      if (options.galleryDirectory) await setInputValue(cdp, "#settings-default-save-folder-input", "C:\\Downloads");
      const initial = await cdp.evaluate(pageExpression(`
        const panel = document.getElementById("settings-panel-downloads");
        const toggle = document.getElementById("settings-auto-organize-toggle");
        const paths = panel?.querySelectorAll(".auto-organize-folder-row") ?? [];
        const list = panel?.querySelector(".auto-organize-rule-list");
        if (!panel || !isVisible(panel)) throw new Error("Downloads settings panel is not visible");
        if (!toggle || toggle.getAttribute("role") !== "switch" || toggle.getAttribute("aria-checked") !== "true") throw new Error("auto-organize toggle is missing its checked switch semantics");
        if (paths.length !== 6) throw new Error("auto-organize must expose exactly six destination paths");
        if (list) throw new Error("fresh profile unexpectedly contains custom rules");
        return { pathRows: paths.length, toggle: accessibleName(toggle), checked: true };
      `));
      await captureGallery("01-six-category-paths", "#settings-panel-downloads");
      await clickByRole(cdp, "button", "Add document preset", ".auto-organize-rule-presets");
      await waitForPage(cdp, `document.querySelectorAll(".auto-organize-rule-card").length === 1`, "first auto-organize rule", options.timeoutMs);
      await clickByRole(cdp, "button", "Add archive preset", ".auto-organize-rule-presets");
      await waitForPage(cdp, `document.querySelectorAll(".auto-organize-rule-card").length === 2`, "second auto-organize rule", options.timeoutMs);
      const semantics = await cdp.evaluate(pageExpression(`
        const list = document.querySelector('.auto-organize-rule-list[role="list"]');
        if (!(list instanceof HTMLElement) || accessibleName(list) !== "Ordered custom rules") throw new Error("custom rules are not exposed as a named list");
        const cards = [...list.children];
        if (cards.length !== 2 || cards.some((card) => card.getAttribute("role") !== "listitem")) throw new Error("custom rules are not exposed as two list items");
        const controls = cards.flatMap((card) => [...card.querySelectorAll("input,select,textarea,button")].filter(isVisible));
        const names = controls.map((control) => accessibleName(control));
        const unnamed = names.filter((name) => !name);
        const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
        if (unnamed.length > 0) throw new Error("custom-rule controls contain blank accessible names");
        if (duplicates.length > 0) throw new Error("custom-rule controls reuse accessible names: " + JSON.stringify(duplicates));
        for (const ruleNumber of [1, 2]) {
          const cardNames = [...cards[ruleNumber - 1].querySelectorAll("input,select,textarea,button")].filter(isVisible).map(accessibleName);
          if (cardNames.some((name) => !name.includes("Rule " + ruleNumber))) throw new Error("Rule " + ruleNumber + " has a control whose accessible name does not identify its rule: " + JSON.stringify(cardNames));
        }
        const measured = [...document.querySelectorAll([
          ".auto-organize-settings .switch-control",
          ".auto-organize-rules button",
          ".auto-organize-rule-grid input",
          ".auto-organize-rule-grid select",
          ".auto-organize-pattern-field > .field-row > input",
        ].join(","))].filter(isVisible).map((control) => {
          const box = control.getBoundingClientRect();
          return { name: accessibleName(control), width: box.width, height: box.height };
        });
        const undersized = measured.filter((control) => control.width < 39.5 || control.height < 39.5);
        if (undersized.length > 0) throw new Error("custom-rule controls are smaller than 40 CSS pixels: " + JSON.stringify(undersized));
        return { list: accessibleName(list), listItems: cards.length, uniqueControlNames: names.length, minimumControlSize: 40, measuredControls: measured.length };
      `));
      await cdp.evaluate(pageExpression(`
        const moveUp = findByRole("button", "Rule 2: Move up", document.querySelectorAll(".auto-organize-rule-card")[1]);
        if (!(moveUp instanceof HTMLButtonElement) || moveUp.disabled) throw new Error("second rule has no enabled keyboard-operable Move up action");
        moveUp.focus();
      `));
      await dispatchKey(cdp, "Enter", "Enter", 13);
      await waitForPage(cdp, `(() => {
        const first = document.querySelector(".auto-organize-rule-card input")?.value;
        return first === "Archive URLs" && document.activeElement?.getAttribute("aria-label") === "Rule 1: Move down";
      })()`, "Enter rule reorder and focus retention", options.timeoutMs);
      await dispatchKey(cdp, " ", "Space", 32);
      await waitForPage(cdp, `(() => {
        const names = [...document.querySelectorAll(".auto-organize-rule-card")].map((card) => card.querySelector("input")?.value ?? "");
        return names.join("|") === "Document filenames|Archive URLs" && document.activeElement?.getAttribute("aria-label") === "Rule 2: Move up";
      })()`, "Space rule reorder and focus retention", options.timeoutMs);
      await dispatchKey(cdp, "Enter", "Enter", 13);
      await waitForPage(cdp, `(() => {
        const names = [...document.querySelectorAll(".auto-organize-rule-card")].map((card) => card.querySelector("input")?.value ?? "");
        return names.join("|") === "Archive URLs|Document filenames" && document.activeElement?.getAttribute("aria-label") === "Rule 1: Move down";
      })()`, "restored first-match order through keyboard", options.timeoutMs);
      const ordered = await cdp.evaluate(pageExpression(`
        const cards = [...document.querySelectorAll(".auto-organize-rule-card")];
        const names = cards.map((card) => card.querySelector("input")?.value ?? "");
        const selects = cards.map((card) => card.querySelector("select")?.value ?? "");
        if (names.join("|") !== "Archive URLs|Document filenames") throw new Error("Move up did not change first-match order: " + names.join("|"));
        if (selects.join("|") !== "compressed|document") throw new Error("preset destinations do not match the six-category contract");
        const focusedCard = document.activeElement?.closest(".auto-organize-rule-card");
        if (focusedCard?.querySelector("input")?.value !== "Archive URLs") throw new Error("keyboard reorder did not retain focus in the moved rule");
        return { names, destinations: selects, keyboardReorder: ["Enter", "Space", "Enter"], focusedRule: "Archive URLs" };
      `));
      await captureGallery("02-ordered-rule-editor", "#settings-auto-organize-rules");
      return { ...initial, ...semantics, ...ordered };
    });

    await runCheck(result, "settings-auto-organize-regex-focus", async () => {
      await clickByRole(cdp, "button", "Open regex builder for Rule 1", ".auto-organize-rule-card");
      await waitForPage(cdp, `Boolean(document.querySelector(".auto-organize-rule-builder .regex-builder"))`, "rule regex builder", options.timeoutMs);
      await captureGallery("03-anchored-regex-builder", ".auto-organize-rule-builder");
      const fixedMode = await cdp.evaluate(pageExpression(`
        const builder = document.querySelector(".auto-organize-rule-builder .regex-builder");
        const toggle = document.getElementById("settings-auto-rule-1-builder-toggle");
        const pattern = builder?.querySelector("input.regex-pattern");
        const radios = builder?.querySelectorAll('input[type="radio"]') ?? [];
        if (!builder || !isVisible(builder)) throw new Error("rule regex builder is hidden");
        if (!(pattern instanceof HTMLInputElement) || pattern.maxLength !== 512) throw new Error("rule pattern editor is not bounded to 512 characters");
        if (radios.length !== 0) throw new Error("classification rule builder must stay in fixed regex mode");
        const controlledId = toggle?.getAttribute("aria-controls");
        const controlled = controlledId ? document.getElementById(controlledId) : null;
        if (!(toggle instanceof HTMLButtonElement) || toggle.getAttribute("aria-expanded") !== "true") throw new Error("rule Regex toggle is not expanded");
        if (!controlledId || !controlled || !controlled.contains(builder)) throw new Error("rule Regex toggle does not control the visible builder");
        const measured = [...builder.querySelectorAll("button,input:not([type=checkbox]):not([type=radio]),textarea,.regex-flags label")].filter(isVisible).map((control) => {
          const box = control.getBoundingClientRect();
          return { name: accessibleName(control), width: box.width, height: box.height };
        });
        const undersized = measured.filter((control) => control.width < 39.5 || control.height < 39.5);
        if (undersized.length > 0) throw new Error("rule builder controls are smaller than 40 CSS pixels: " + JSON.stringify(undersized));
        return { fixedRegex: true, patternMaxLength: pattern.maxLength, radioCount: radios.length, originalPattern: pattern.value, controlledId, minimumBuilderControlSize: 40, measuredBuilderControls: measured.length };
      `));
      await setInputValue(cdp, ".auto-organize-rule-builder input.regex-pattern", "a".repeat(511));
      await clickByRole(cdp, "button", "Rule 1 classification regex builder: End anchor", ".auto-organize-rule-builder .regex-guided");
      await waitForPage(cdp, `document.querySelector(".auto-organize-rule-builder input.regex-pattern")?.value.length === 512`, "guided insertion reaches the 512-character boundary", options.timeoutMs);
      const guided511 = await cdp.evaluate(pageExpression(`
        const pattern = document.querySelector(".auto-organize-rule-builder input.regex-pattern");
        const status = document.querySelector(".auto-organize-rule-builder .field-error[role=status]");
        if (!(pattern instanceof HTMLInputElement) || pattern.value.length !== 512 || !pattern.value.endsWith("$")) throw new Error("a one-character guided fragment was not accepted from 511 to 512 characters");
        if (status) throw new Error("a valid guided insertion at the exact 512-character boundary reported an error");
        return { startingLength: 511, resultingLength: pattern.value.length, accepted: true };
      `));
      await clickByRole(cdp, "button", "Rule 1 classification regex builder: End anchor", ".auto-organize-rule-builder .regex-guided");
      await waitForPage(cdp, `Boolean(document.querySelector(".auto-organize-rule-builder .field-error[role=status]"))`, "guided insertion refusal at 512 characters", options.timeoutMs);
      const guided512 = await cdp.evaluate(pageExpression(`
        const pattern = document.querySelector(".auto-organize-rule-builder input.regex-pattern");
        const status = document.querySelector(".auto-organize-rule-builder .field-error[role=status]");
        if (!(pattern instanceof HTMLInputElement) || pattern.value.length !== 512) throw new Error("guided insertion exceeded or changed the 512-character pattern");
        if (!(status instanceof HTMLElement) || !/was not added/.test(status.textContent ?? "")) throw new Error("512-character refusal has no actionable status");
        if (!(pattern.getAttribute("aria-describedby") ?? "").split(/\\s+/).includes(status.id)) throw new Error("512-character refusal status is not associated with the pattern field");
        return { length: pattern.value.length, status: status.textContent?.trim() ?? "" };
      `));
      await setInputValue(cdp, ".auto-organize-rule-builder input.regex-pattern", fixedMode.originalPattern);
      await waitForPage(cdp, `document.querySelector("#settings-auto-rule-1-pattern")?.value === ${JSON.stringify(fixedMode.originalPattern)}`, "restored preset regex after boundary checks", options.timeoutMs);
      async function clickRuleFlag(flag) {
        await cdp.evaluate(pageExpression(`
          const label = [...document.querySelectorAll(".auto-organize-rule-builder .regex-flags label")]
            .find((candidate) => candidate.querySelector("code")?.textContent === ${JSON.stringify(flag)});
          const input = label?.querySelector('input[type="checkbox"]');
          if (!(input instanceof HTMLInputElement)) throw new Error("missing rule flag " + ${JSON.stringify(flag)});
          input.click();
        `));
      }
      await clickRuleFlag("u");
      await waitForPage(cdp, `document.querySelector(".auto-organize-flags-summary code")?.textContent === "iu"`, "normalized i+u flags", options.timeoutMs);
      await clickRuleFlag("i");
      await waitForPage(cdp, `document.querySelector(".auto-organize-flags-summary code")?.textContent === "u"`, "remove i flag", options.timeoutMs);
      await clickRuleFlag("i");
      await waitForPage(cdp, `document.querySelector(".auto-organize-flags-summary code")?.textContent === "iu"`, "canonical flag order after out-of-order clicks", options.timeoutMs);
      await dispatchEscape(cdp);
      await waitForPage(cdp, pageExpression(`
        const toggle = document.getElementById("settings-auto-rule-1-builder-toggle");
        const controlledId = toggle?.getAttribute("aria-controls");
        return !document.querySelector(".auto-organize-rule-builder") && !!toggle && accessibleName(toggle) === "Open regex builder for Rule 1" && toggle.getAttribute("aria-expanded") === "false" && !document.getElementById(controlledId ?? "") && document.activeElement === toggle;
      `), "rule builder Escape focus restoration", options.timeoutMs);
      return { ...fixedMode, guided511, guided512, flags: "iu", escapeClosed: true, focusRestored: true };
    });

    await runCheck(result, "settings-auto-organize-contrast", async () => {
      await clickByRole(cdp, "button", "Open regex builder for Rule 1", ".auto-organize-rule-card");
      await waitForPage(cdp, `Boolean(document.querySelector(".auto-organize-rule-builder .regex-builder"))`, "rule builder for contrast sampling", options.timeoutMs);
      await setInputValue(cdp, 'input[aria-label="Search settings"]', "auto");
      await waitForPage(cdp, `Boolean(document.querySelector(".settings-search-results .setting-helper"))`, "Settings result helper for contrast sampling", options.timeoutMs);
      try {
        return await cdp.evaluate(pageExpression(`
          const root = document.documentElement;
          const originalTheme = root.getAttribute("data-theme");
          function inspectTheme(theme) {
            root.setAttribute("data-theme", theme);
            const samples = [
              { label: "folder path", text: document.querySelector(".auto-organize-folder-row code"), surface: document.querySelector(".auto-organize-folder-map") },
              { label: "rules helper", text: document.querySelector(".auto-organize-rules > .setting-helper"), surface: document.querySelector(".auto-organize-rules") },
              { label: "rules source", text: document.querySelector(".auto-organize-rules > .setting-source"), surface: document.querySelector(".auto-organize-rules") },
              { label: "rule heading helper", text: document.querySelector(".auto-organize-rule-card-heading > span"), surface: document.querySelector(".auto-organize-rule-card") },
              { label: "flags helper", text: document.querySelector(".auto-organize-flags-summary .setting-helper"), surface: document.querySelector(".auto-organize-rule-card") },
              { label: "regex header", text: document.querySelector(".auto-organize-rule-builder .regex-builder-header p"), surface: document.querySelector(".auto-organize-rule-builder .regex-builder") },
              { label: "regex dialect", text: document.querySelector(".auto-organize-rule-builder .regex-dialect-note"), surface: document.querySelector(".auto-organize-rule-builder .regex-builder") },
              { label: "settings result helper", text: document.querySelector(".settings-search-results .setting-helper"), surface: document.querySelector(".settings-search-results") },
            ];
            const missing = samples.filter(({ text, surface }) => !(text instanceof HTMLElement) || !(surface instanceof HTMLElement));
            if (missing.length > 0) throw new Error(theme + " contrast samples are missing: " + missing.map(({ label }) => label).join(", "));
            const measured = samples.map(({ label, text, surface }) => {
              const foreground = getComputedStyle(text).color;
              const background = getComputedStyle(surface).backgroundColor;
              return { label, foreground, background, ratio: contrastRatio(foreground, background) };
            });
            const failures = measured.filter(({ ratio }) => ratio < 4.5);
            if (failures.length > 0) throw new Error(theme + " auto-organize text falls below 4.5:1: " + JSON.stringify(failures));
            return measured.map(({ label, ratio }) => ({ label, ratio: Number(ratio.toFixed(2)) }));
          }
          try {
            return { dark: inspectTheme("dark"), light: inspectTheme("light"), minimum: 4.5 };
          } finally {
            if (originalTheme === null) root.removeAttribute("data-theme");
            else root.setAttribute("data-theme", originalTheme);
          }
        `));
      } finally {
        await dispatchEscape(cdp);
        await waitForPage(cdp, `!document.querySelector(".auto-organize-rule-builder")`, "close rule builder after contrast sampling", options.timeoutMs).catch(() => undefined);
        await setInputValue(cdp, 'input[aria-label="Search settings"]', "").catch(() => undefined);
      }
    });

    await runCheck(result, "settings-auto-organize-invalid-save", async () => {
      await clickByRole(cdp, "button", "Add blank rule", ".auto-organize-rule-presets");
      await waitForPage(cdp, `document.querySelectorAll(".auto-organize-rule-card").length === 3`, "blank auto-organize rule", options.timeoutMs);
      await waitForPage(cdp, `Boolean(document.querySelectorAll(".auto-organize-rule-card")[2]?.querySelector(".regex-builder"))`, "blank rule fixed regex builder", options.timeoutMs);
      const blankBuilder = await cdp.evaluate(pageExpression(`
        const builder = document.querySelectorAll(".auto-organize-rule-card")[2]?.querySelector(".regex-builder");
        const pattern = builder?.querySelector("input.regex-pattern");
        const alert = builder?.querySelector('.regex-dialect-note[role="alert"]');
        const copy = builder ? findByRole("button", "Rule 3 classification regex builder: Copy", builder) : null;
        const exportButton = builder ? findByRole("button", "Rule 3 classification regex builder: Export", builder) : null;
        if (!(pattern instanceof HTMLInputElement) || pattern.getAttribute("aria-invalid") !== "true") throw new Error("blank fixed-regex builder Pattern is not invalid");
        if (!(alert instanceof HTMLElement) || !/Enter a regular expression pattern/.test(alert.textContent ?? "")) throw new Error("blank fixed-regex builder has no live actionable error");
        if (!(pattern.getAttribute("aria-describedby") ?? "").split(/\\s+/).includes(alert.id)) throw new Error("blank builder error is not associated with Pattern");
        for (const control of [copy, exportButton]) {
          if (!(control instanceof HTMLButtonElement) || !control.disabled || !control.title || !(control.getAttribute("aria-describedby") ?? "").split(/\\s+/).includes(alert.id)) {
            throw new Error("blank builder Copy/Export has no accessible disabled explanation");
          }
        }
        return { patternInvalid: true, alert: alert.textContent?.trim() ?? "", disabledActionsExplained: 2 };
      `));
      await captureGallery("04-inline-invalid-rule", "#settings-auto-organize-rules");
      await setInputValue(cdp, "#settings-auto-rule-3-pattern", "temporary");
      await setInputValue(cdp, "#settings-auto-rule-3-name", "");
      await waitForPage(cdp, `document.querySelector("#settings-auto-rule-3-name")?.getAttribute("aria-invalid") === "true"`, "blank rule-name validation", options.timeoutMs);
      const blankName = await cdp.evaluate(pageExpression(`
        const card = document.querySelectorAll(".auto-organize-rule-card")[2];
        const name = document.getElementById("settings-auto-rule-3-name");
        const pattern = document.getElementById("settings-auto-rule-3-pattern");
        const errorId = name?.getAttribute("aria-describedby");
        const error = errorId ? document.getElementById(errorId) : null;
        const save = findByRole("button", "Save", document.querySelector('[role="dialog"]'));
        if (!card?.classList.contains("invalid")) throw new Error("blank-name rule is not marked invalid");
        if (!(name instanceof HTMLInputElement) || name.getAttribute("aria-invalid") !== "true") throw new Error("blank-name error is not attached to the name field");
        if (!(error instanceof HTMLElement) || error.getAttribute("role") !== "alert" || error.textContent?.trim() !== "Enter a rule name.") throw new Error("blank-name field does not reference its exact inline alert");
        if (pattern?.getAttribute("aria-invalid") === "true" || pattern?.hasAttribute("aria-describedby")) throw new Error("blank-name error leaked onto the pattern field");
        if (!(save instanceof HTMLButtonElement) || !save.disabled || !save.getAttribute("aria-describedby") || !save.title) throw new Error("Save has no accessible explanation while the blank name blocks it");
        return { field: "name", error: error.textContent.trim(), saveBlocked: true, saveExplanation: save.title };
      `));
      await setInputValue(cdp, "#settings-auto-rule-3-name", "Temporary rule");
      await setInputValue(cdp, "#settings-auto-rule-3-pattern", "(");
      await waitForPage(cdp, `document.querySelector("#settings-auto-rule-3-pattern")?.getAttribute("aria-invalid") === "true"`, "bad-pattern validation", options.timeoutMs);
      const badPattern = await cdp.evaluate(pageExpression(`
        const root = document.documentElement;
        const originalTheme = root.getAttribute("data-theme");
        const card = document.querySelectorAll(".auto-organize-rule-card")[2];
        const name = document.getElementById("settings-auto-rule-3-name");
        const pattern = document.getElementById("settings-auto-rule-3-pattern");
        const errorId = pattern?.getAttribute("aria-describedby");
        const error = errorId ? document.getElementById(errorId) : null;
        if (!(pattern instanceof HTMLInputElement) || pattern.getAttribute("aria-invalid") !== "true") throw new Error("bad-pattern error is not attached to the pattern field");
        if (!(error instanceof HTMLElement) || error.getAttribute("role") !== "alert" || !/^Invalid regex:/.test(error.textContent?.trim() ?? "")) throw new Error("bad-pattern field does not reference its exact inline alert");
        if (name?.getAttribute("aria-invalid") === "true" || name?.hasAttribute("aria-describedby")) throw new Error("bad-pattern error leaked onto the name field");
        const ratios = {};
        try {
          for (const theme of ["dark", "light"]) {
            root.setAttribute("data-theme", theme);
            const ratio = contrastRatio(getComputedStyle(error).color, getComputedStyle(card).backgroundColor);
            if (ratio < 4.5) throw new Error(theme + " inline rule error contrast is " + ratio.toFixed(2) + ":1");
            ratios[theme] = Number(ratio.toFixed(2));
          }
        } finally {
          if (originalTheme === null) root.removeAttribute("data-theme");
          else root.setAttribute("data-theme", originalTheme);
        }
        return { field: "pattern", error: error.textContent.trim(), contrast: ratios };
      `));
      await cdp.evaluate(pageExpression(`
        const remove = findByRole("button", "Rule 3: Remove rule", document.querySelectorAll(".auto-organize-rule-card")[2]);
        if (!(remove instanceof HTMLButtonElement)) throw new Error("invalid rule has no specifically named Remove rule action");
        remove.focus();
      `));
      await dispatchKey(cdp, "Enter", "Enter", 13);
      await waitForPage(cdp, `(() => {
        const save = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.trim() === "Save");
        const successor = document.getElementById("settings-auto-rule-2-name");
        return document.querySelectorAll(".auto-organize-rule-card").length === 2 && !!save && !save.disabled && successor?.value === "Document filenames" && document.activeElement === successor;
      })()`, "rule removal restores Save and focuses its successor", options.timeoutMs);
      return { blankBuilder, blankName, badPattern, removalFocus: { target: "settings-auto-rule-2-name", value: "Document filenames" } };
    });

    await runCheck(result, "settings-auto-organize-save-persistence", async () => {
      await clickByRole(cdp, "button", "Save", '[role="dialog"]');
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "settings Save through preload and IPC", options.timeoutMs);
      await clickByRole(cdp, "button", "Settings");
      await waitForPage(cdp, `Boolean(document.querySelector(".dialog"))`, "reopened Settings dialog", options.timeoutMs);
      await clickByRole(cdp, "tab", "Downloads", '[role="dialog"]');
      await waitForPage(cdp, `document.querySelectorAll(".auto-organize-rule-card").length === 2`, "persisted auto-organize rules", options.timeoutMs);
      const dom = await cdp.evaluate(pageExpression(`
        const names = [...document.querySelectorAll(".auto-organize-rule-card")]
          .map((card) => card.querySelector("input")?.value ?? "");
        const paths = document.querySelectorAll(".auto-organize-folder-row").length;
        if (names.join("|") !== "Archive URLs|Document filenames") throw new Error("saved first-match order did not survive reopening");
        if (paths !== 6) throw new Error("reopened Downloads settings lost the six destination paths");
        return { names, paths };
      `));
      const settings = await cdp.evaluate("window.api.getSettings()");
      if (settings.autoOrganizeRules?.length !== 2 || settings.autoOrganizeRules[0]?.flags !== "iu") throw new Error("real preload/settings IPC did not persist canonical custom rules");
      if (settings.settingProvenance?.autoOrganizeRules !== "persisted") throw new Error("main process did not stamp custom-rule provenance");
      if (settings.settingProvenance?.autoOrganizeEnabled !== "compiled-in") throw new Error("unchanged auto-organize toggle was falsely marked persisted by Settings Save");
      return {
        ...dom,
        persistedRules: settings.autoOrganizeRules.length,
        flags: settings.autoOrganizeRules[0].flags,
        provenance: settings.settingProvenance.autoOrganizeRules,
        untouchedToggleProvenance: settings.settingProvenance.autoOrganizeEnabled,
      };
    });

    await runCheck(result, "settings-auto-organize-search-targets", async () => {
      const values = await cdp.evaluate(pageExpression(`
        const name = document.getElementById("settings-auto-rule-1-name");
        const pattern = document.getElementById("settings-auto-rule-1-pattern");
        const path = document.querySelector(".auto-organize-folder-row code");
        if (!(name instanceof HTMLInputElement) || !(pattern instanceof HTMLInputElement) || !(path instanceof HTMLElement)) throw new Error("dynamic auto-organize search values are unavailable");
        return { name: name.value, pattern: pattern.value, path: path.textContent?.trim() ?? "" };
      `));
      async function searchAndFocus(query, resultName, targetId, label) {
        await setInputValue(cdp, 'input[aria-label="Search settings"]', query);
        await waitForPage(cdp, pageExpression(`
          const results = document.querySelector(".settings-search-results");
          return !!results && !!findByRole("button", ${JSON.stringify(resultName)}, results);
        `), label + " search result", options.timeoutMs);
        await clickByRole(cdp, "button", resultName, ".settings-search-results");
        await waitForPage(cdp, `document.activeElement?.id === ${JSON.stringify(targetId)}`, label + " exact target focus", options.timeoutMs);
        return cdp.evaluate(pageExpression(`
          const target = document.getElementById(${JSON.stringify(targetId)});
          if (!(target instanceof HTMLElement) || document.activeElement !== target) throw new Error(${JSON.stringify(label + " result did not focus " + targetId)});
          return { query: ${JSON.stringify(query)}, result: ${JSON.stringify(resultName)}, target: target.id, targetName: accessibleName(target) };
        `));
      }
      const ruleName = await searchAndFocus(values.name, "Rule 1 name", "settings-auto-rule-1-name", "dynamic rule-name");
      const rulePattern = await searchAndFocus(values.pattern, "Rule 1 regex pattern and flags", "settings-auto-rule-1-pattern", "dynamic rule-pattern");
      const destinationPath = await searchAndFocus(
        values.path,
        "General destination path",
        "settings-auto-organize-path-other",
        "dynamic destination-path"
      );
      return { ruleName, rulePattern, destinationPath };
    });

    await runCheck(result, "settings-narrow-layout", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 520, height: 720, deviceScaleFactor: 2, mobile: false });
      try {
        const tabNames = ["Language", "Appearance", "Downloads", "Authenticator", "Advanced"];
        const panels = [];
        for (const tabName of tabNames) {
          await clickByRole(cdp, "tab", tabName, '[role="dialog"]');
          try {
            await waitForPage(
              cdp,
              "document.querySelector('[role=\"tablist\"][aria-label=\"Settings sections\"] [role=\"tab\"][aria-selected=\"true\"]')?.textContent?.trim() === " + JSON.stringify(tabName),
              tabName + " settings tab at the narrow viewport",
              Math.min(options.timeoutMs, 5_000)
            );
          } catch (error) {
            const state = await cdp.evaluate(pageExpression(`
              const tabList = document.querySelector('[role="tablist"]');
              return {
                tabListLabel: tabList?.getAttribute("aria-label"),
                selected: [...(tabList?.querySelectorAll('[role="tab"]') ?? [])]
                  .filter((tab) => tab.getAttribute("aria-selected") === "true")
                  .map((tab) => ({ text: tab.textContent?.trim(), name: accessibleName(tab), visible: isVisible(tab) })),
                tabs: [...(tabList?.querySelectorAll('[role="tab"]') ?? [])]
                  .map((tab) => ({ text: tab.textContent?.trim(), name: accessibleName(tab), visible: isVisible(tab) })),
              };
            `));
            throw new Error(`${error instanceof Error ? error.message : String(error)}; tab state=${JSON.stringify(state)}`);
          }
          panels.push(await cdp.evaluate(pageExpression(`
            const dialog = document.querySelector('[role="dialog"]');
            const panel = document.querySelector('.settings-tab-panel[role="tabpanel"]');
            if (!dialog || !isVisible(dialog) || !panel || !isVisible(panel)) throw new Error("Settings tab panel is not visible at the narrow viewport");
            const overflowValues = [
              document.documentElement.scrollWidth - window.innerWidth,
              document.body.scrollWidth - window.innerWidth,
              dialog.scrollWidth - dialog.clientWidth,
              panel.scrollWidth - panel.clientWidth,
            ];
            const horizontalOverflow = Math.max(0, ...overflowValues);
            if (horizontalOverflow > 1) {
              const offenders = [...panel.querySelectorAll("*")]
                .filter((element) => element.scrollWidth > element.clientWidth + 1)
                .map((element) => ({ tag: element.tagName.toLowerCase(), id: element.id, className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
                .slice(0, 8);
              throw new Error("narrow Settings viewport overflows horizontally: " + JSON.stringify({ panel: panel.id, innerWidth: window.innerWidth, overflowValues, dialog: { clientWidth: dialog.clientWidth, scrollWidth: dialog.scrollWidth }, panelBox: { clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth }, offenders }));
            }
            const visibleGrids = [...panel.querySelectorAll(".field-pair,.settings-level-grid,.auto-organize-rule-grid,.auto-organize-folder-row")].filter(isVisible);
            const wideGrids = visibleGrids.filter((grid) => getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length > 1);
            if (wideGrids.length > 0) throw new Error("narrow Settings viewport kept a multi-column grid: " + wideGrids.map((grid) => grid.className).join(", "));
            const unnamedControls = [...panel.querySelectorAll("input,select,textarea,button")]
              .filter(isVisible)
              .map((control) => ({ id: control.id, tag: control.tagName.toLowerCase(), name: accessibleName(control) }))
              .filter((control) => !control.name);
            if (unnamedControls.length > 0) throw new Error("narrow Settings tab contains unnamed controls: " + JSON.stringify(unnamedControls));
            return { panel: panel.id, horizontalOverflow, singleColumnGrids: visibleGrids.length, unnamedControls: 0 };
          `)));
          if (tabName === "Downloads" && options.galleryDirectory) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width: 520, height: 760, deviceScaleFactor: 1, mobile: false });
            await clickByRole(cdp, "button", "Open regex builder for Rule 1", ".auto-organize-rule-card");
            await waitForPage(cdp, `Boolean(document.querySelector(".auto-organize-rule-builder .regex-builder"))`, "gallery narrow rule builder", options.timeoutMs);
            await captureGallery("05-narrow-rule-layout", ".auto-organize-rule-builder");
            await dispatchEscape(cdp);
            await waitForPage(cdp, `!document.querySelector(".auto-organize-rule-builder")`, "close gallery narrow rule builder", options.timeoutMs);
            await cdp.send("Emulation.setDeviceMetricsOverride", { width: 520, height: 720, deviceScaleFactor: 2, mobile: false });
          }
        }
        await clickByRole(cdp, "tab", "Language", '[role="dialog"]');
        await waitForPage(cdp, 'document.querySelector(\'[role="tablist"][aria-label="Settings sections"] [role="tab"][aria-selected="true"]\')?.textContent?.trim() === "Language"', "restore Language settings tab", options.timeoutMs);
        return { innerWidth: 520, innerHeight: 720, deviceScaleFactor: 2, panels };
      } finally {
        await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
      }
    });

    await runCheck(result, "settings-auto-organize-narrow-bilingual", async () => {
      let evidence;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 520, height: 760, deviceScaleFactor: 2, mobile: false });
      try {
        await setSelectValue(cdp, "#settings-language-mode", "bilingual");
        await waitForPage(cdp, `document.getElementById("settings-language-mode")?.value === "bilingual" && /語言/.test(document.getElementById("settings-tab-language")?.textContent ?? "")`, "bilingual Settings mode at 520px", options.timeoutMs);
        await cdp.evaluate(`document.getElementById("settings-tab-downloads")?.click()`);
        await waitForPage(cdp, `document.getElementById("settings-tab-downloads")?.getAttribute("aria-selected") === "true"`, "bilingual Downloads settings tab", options.timeoutMs);
        await setInputValue(cdp, '.settings-search input[type="search"]', "rule");
        await waitForPage(cdp, `(() => {
          const text = document.querySelector(".settings-search-results .setting-helper")?.textContent ?? "";
          return /matching settings/.test(text) && /個相符設定/.test(text);
        })()`, "localized plural Settings result", options.timeoutMs);
        await cdp.evaluate(`document.getElementById("settings-auto-rule-1-builder-toggle")?.click()`);
        await waitForPage(cdp, `Boolean(document.querySelector(".auto-organize-rule-builder .regex-builder"))`, "bilingual rule builder at 520px", options.timeoutMs);
        evidence = await cdp.evaluate(pageExpression(`
          const dialog = document.querySelector('[role="dialog"]');
          const panel = document.getElementById("settings-panel-downloads");
          if (!(dialog instanceof HTMLElement) || !(panel instanceof HTMLElement) || !isVisible(panel)) throw new Error("bilingual Downloads settings is not visible at 520px");
          const overflowValues = {
            document: document.documentElement.scrollWidth - window.innerWidth,
            body: document.body.scrollWidth - window.innerWidth,
            dialog: dialog.scrollWidth - dialog.clientWidth,
            panel: panel.scrollWidth - panel.clientWidth,
          };
          if (Math.max(...Object.values(overflowValues)) > 1) throw new Error("520px bilingual auto-organize layout overflows horizontally: " + JSON.stringify(overflowValues));
          const dialogBox = dialog.getBoundingClientRect();
          const builder = panel.querySelector(".auto-organize-rule-builder .regex-builder");
          if (!(builder instanceof HTMLElement) || !isVisible(builder)) throw new Error("bilingual rule builder is not visible at 520px");
          const builderBox = builder.getBoundingClientRect();
          if (builderBox.left < dialogBox.left - 1 || builderBox.right > dialogBox.right + 1 || builder.scrollWidth > builder.clientWidth + 1) {
            throw new Error("520px bilingual rule builder escapes or clips inside the dialog: " + JSON.stringify({ dialogBox, builderBox, clientWidth: builder.clientWidth, scrollWidth: builder.scrollWidth }));
          }
          const controls = [...panel.querySelectorAll(".auto-organize-settings input,.auto-organize-settings select,.auto-organize-settings button,.auto-organize-rules input,.auto-organize-rules select,.auto-organize-rules textarea,.auto-organize-rules button")].filter(isVisible);
          const outside = controls.map((control) => ({ name: accessibleName(control), box: control.getBoundingClientRect() })).filter(({ box }) => box.left < dialogBox.left - 1 || box.right > dialogBox.right + 1);
          if (outside.length > 0) throw new Error("520px bilingual auto-organize controls escape the dialog: " + JSON.stringify(outside.slice(0, 8)));
          const textNodes = [...panel.querySelectorAll(".auto-organize-settings .setting-helper,.auto-organize-settings .setting-source,.auto-organize-folder-row strong,.auto-organize-folder-row code,.auto-organize-rules > .setting-helper,.auto-organize-rules > .setting-source,.auto-organize-rule-card-heading > strong,.auto-organize-rule-card-heading > span,.auto-organize-flags-summary .setting-helper,.auto-organize-rule-builder .regex-builder-header h3,.auto-organize-rule-builder .regex-builder-header p,.auto-organize-rule-builder .regex-dialect-note,.auto-organize-rule-builder .regex-guided .field-label,.auto-organize-rule-builder .regex-flags .field-label,.auto-organize-rule-builder .regex-results-header,.auto-organize-rule-builder .regex-empty")].filter(isVisible);
          const clipped = textNodes.map((element) => ({
            text: normalise(element.textContent),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            overflowX: getComputedStyle(element).overflowX,
          })).filter((item) => item.clientWidth > 0 && item.scrollWidth > item.clientWidth + 1);
          if (clipped.length > 0) throw new Error("520px bilingual auto-organize text is clipped: " + JSON.stringify(clipped.slice(0, 8)));
          const list = panel.querySelector('.auto-organize-rule-list[role="list"]');
          if (!list || list.querySelectorAll('[role="listitem"]').length !== 2) throw new Error("bilingual narrow layout lost custom-rule list semantics");
          const resultCountText = panel.querySelector(".settings-search-results .setting-helper")?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
          const resultCount = Number(resultCountText.match(/^(\\d+)/)?.[1] ?? "0");
          if (resultCount < 2 || !/matching settings/.test(resultCountText) || !/個相符設定/.test(resultCountText) || /設定s/.test(resultCountText)) {
            throw new Error("bilingual Settings count is not fully localized: " + JSON.stringify(resultCountText));
          }
          return { innerWidth: window.innerWidth, language: "bilingual", horizontalOverflow: overflowValues, controlsInsideDialog: controls.length, clippedText: 0, ruleItems: 2, openRuleBuilder: true, localizedResultCount: resultCountText };
        `));
        await dispatchEscape(cdp);
        await waitForPage(cdp, `!document.querySelector(".auto-organize-rule-builder") && document.activeElement?.id === "settings-auto-rule-1-builder-toggle"`, "bilingual narrow builder Escape focus", options.timeoutMs);
        evidence.builderEscapeFocus = true;
        if (options.galleryDirectory) {
          await cdp.send("Emulation.clearDeviceMetricsOverride");
          await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
          await setInputValue(cdp, '.settings-search input[type="search"]', "");
          await cdp.evaluate(`document.getElementById("settings-tab-downloads")?.click()`);
          await waitForPage(cdp, `document.getElementById("settings-tab-downloads")?.getAttribute("aria-selected") === "true" && !document.querySelector(".auto-organize-rule-builder")`, "normal-width bilingual Downloads gallery state", options.timeoutMs);
          await captureGallery("06-bilingual-category-settings", "#settings-panel-downloads");
        }
      } finally {
        await cdp.evaluate(`document.getElementById("settings-tab-language")?.click()`).catch(() => undefined);
        await waitForPage(cdp, `document.getElementById("settings-tab-language")?.getAttribute("aria-selected") === "true"`, "restore Language tab after bilingual narrow check", options.timeoutMs).catch(() => undefined);
        await setSelectValue(cdp, "#settings-language-mode", "english").catch(() => undefined);
        await waitForPage(cdp, `document.getElementById("settings-language-mode")?.value === "english"`, "restore English after bilingual narrow check", options.timeoutMs).catch(() => undefined);
        await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
      }
      return evidence;
    });

    await runCheck(result, "settings-tabs", async () => {
      const initial = await cdp.evaluate(pageExpression(`
        const tabList = document.querySelector('[role="tablist"][aria-label="Settings sections"]');
        const tabs = tabList ? [...tabList.querySelectorAll('[role="tab"]')] : [];
        const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
        const panelId = selected[0]?.getAttribute("aria-controls");
        const panel = panelId ? document.getElementById(panelId) : null;
        if (!tabList || tabs.length !== 5) throw new Error("Settings surface must expose five browser-style tabs");
        if (selected.length !== 1 || !panel || !isVisible(panel)) throw new Error("Settings tab selection does not expose one visible panel");
        return { tabCount: tabs.length, selected: accessibleName(selected[0]), panel: panel.id };
      `));
      await clickByRole(cdp, "tab", "Appearance");
      await waitForPage(cdp, `document.querySelector('[role="tablist"][aria-label="Settings sections"] [role="tab"][aria-selected="true"]')?.textContent?.trim() === "Appearance"`, "Appearance settings tab", options.timeoutMs);
      const appearance = await cdp.evaluate(pageExpression(`
        const panel = document.getElementById("settings-panel-appearance");
        const search = panel?.querySelector('input[aria-label="Search settings"]');
        const theme = panel?.querySelector("#settings-theme");
        if (!panel || !isVisible(panel) || !theme || !isVisible(theme)) throw new Error("Appearance settings panel is not visible");
        if (!(search instanceof HTMLInputElement)) throw new Error("Appearance tab has no independent settings search");
        return { panel: panel.id, search: true, theme: true, persistedTab: window.localStorage.getItem("material-download-manager.settings.active-tab") };
      `));
      await setInputValue(cdp, 'input[aria-label="Search settings"]', "display name");
      await waitForPage(cdp, `Boolean(document.querySelector("#settings-panel-appearance .settings-search-results")?.textContent?.match(/matching setting/i))`, "Appearance tab search result", options.timeoutMs);
      await cdp.evaluate(pageExpression(`
        const tab = document.getElementById("settings-tab-appearance");
        if (!(tab instanceof HTMLElement)) throw new Error("Appearance tab control is missing");
        tab.focus();
        tab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      `));
      await waitForPage(cdp, `document.querySelector('[role="tablist"][aria-label="Settings sections"] [role="tab"][aria-selected="true"]')?.textContent?.trim() === "Language"`, "Arrow-key settings tab navigation", options.timeoutMs);
      return { ...initial, appearance, keyboardNavigation: "ArrowLeft moved to Language" };
    });

    await runCheck(result, "settings-search-control", async () => cdp.evaluate(pageExpression(`
      const search = document.querySelector('input[aria-label="Search settings"]');
      if (!(search instanceof HTMLInputElement) || !isVisible(search)) throw new Error('Search settings input is missing or hidden');
      if (search.type !== "search") throw new Error("Search settings control has type " + JSON.stringify(search.type) + ', not "search"');
      search.focus();
      if (document.activeElement !== search) throw new Error("Search settings input did not accept focus");
      return { type: search.type, accessibleName: accessibleName(search), focused: true };
    `)));

    await runCheck(result, "settings-search-interaction", async () => {
      await setInputValue(cdp, 'input[aria-label="Search settings"]', "language");
      await waitForPage(
        cdp,
        `Boolean(document.querySelector(".settings-search-results")?.textContent?.match(/matching setting/i))`,
        "Settings search results",
        options.timeoutMs
      );
      return cdp.evaluate(`(() => {
        const results = document.querySelector(".settings-search-results");
        const text = results?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        if (!/matching setting/i.test(text)) throw new Error("Settings search returned no matching-setting status");
        return { query: document.querySelector('input[aria-label="Search settings"]')?.value ?? "", resultText: text };
      })()`);
    });

    await runCheck(result, "settings-regex-builder", async () => {
      await clickByRole(cdp, "button", "Regex", ".settings-search-row");
      await waitForPage(cdp, `Boolean(document.querySelector('.settings-search-builder section[aria-label$="regex builder"]'))`, "Settings regex builder", options.timeoutMs);
      return cdp.evaluate(pageExpression(`
        const builder = document.querySelector('.settings-search-builder section[aria-label$="regex builder"]');
        const row = document.querySelector(".settings-search-row");
        const toggle = row ? findByRole("button", "Regex", row) : null;
        const modeGroup = builder?.querySelector('[role="radiogroup"]');
        const radios = builder ? builder.querySelectorAll('input[type="radio"]') : [];
        const pattern = builder?.querySelector('input.regex-pattern');
        if (!builder || !isVisible(builder)) throw new Error("Settings regex builder is missing or hidden");
        if (!modeGroup || !/Search mode$/.test(accessibleName(modeGroup)) || radios.length < 2) throw new Error("Settings regex builder is missing its contextual accessible search-mode radio group");
        if (!(pattern instanceof HTMLInputElement)) throw new Error("Settings regex builder is missing its pattern editor");
        if (!toggle || toggle.getAttribute("aria-expanded") !== "true") throw new Error("Settings Regex toggle did not expose aria-expanded=true");
        const controlledId = toggle.getAttribute("aria-controls");
        const controlled = controlledId ? document.getElementById(controlledId) : null;
        if (!controlledId || !(controlled instanceof HTMLElement) || !controlled.contains(builder)) throw new Error("Settings Regex toggle aria-controls does not identify the visible builder");
        return { visible: true, modeGroup: accessibleName(modeGroup), radioCount: radios.length, patternInput: true, expanded: true, controlledId };
      `));
    });

    await runCheck(result, "escape-closes-builder-and-restores-focus", async () => {
      await dispatchEscape(cdp);
      await waitForPage(
        cdp,
        `(() => {
          const builderClosed = !document.querySelector('.settings-search-builder section[aria-label$="regex builder"]');
          const row = document.querySelector(".settings-search-row");
          const toggle = row?.querySelector("button[aria-expanded]");
          return builderClosed && !!toggle && toggle.getAttribute("aria-expanded") === "false" && document.activeElement === toggle;
        })()`,
        "regex builder to close and restore focus on Escape",
        options.timeoutMs
      );
      return cdp.evaluate(pageExpression(`
        const row = document.querySelector(".settings-search-row");
        const toggle = row ? findByRole("button", "Regex", row) : null;
        if (!toggle) throw new Error("Settings Regex toggle disappeared after Escape");
        if (toggle.getAttribute("aria-expanded") !== "false") throw new Error("Settings Regex toggle did not expose aria-expanded=false after Escape");
        if (document.activeElement !== toggle) throw new Error("Escape did not restore focus to the Settings Regex toggle");
        const controlledId = toggle.getAttribute("aria-controls");
        if (!controlledId || document.getElementById(controlledId)) throw new Error("Settings Regex controlled panel remained mounted after Escape");
        return { expanded: false, focusRestored: true, controlledId, controlledPanelRemoved: true };
      `));
    });

    await runCheck(result, "settings-browser-extension-install-and-reveal", async () => {
      await clickByRole(cdp, "tab", "Downloads", '[role="dialog"]');
      await waitForPage(cdp, `document.getElementById("settings-tab-downloads")?.getAttribute("aria-selected") === "true"`, "Downloads settings tab for browser extension install", options.timeoutMs);
      const before = await cdp.evaluate(pageExpression(`
        const panel = document.getElementById("settings-panel-downloads");
        const card = document.getElementById("settings-browser-extension");
        const helper = document.getElementById("settings-install-extension-helper");
        const install = document.getElementById("settings-install-extension");
        const search = panel?.querySelector('input[aria-label="Search settings"]');
        const regex = panel?.querySelector('.settings-search-row button[aria-expanded]');
        if (!(panel instanceof HTMLElement) || !isVisible(panel)) throw new Error("Downloads settings panel is not visible");
        if (!(card instanceof HTMLElement) || !isVisible(card)) throw new Error("browser-extension install card is missing or hidden");
        if (!(helper instanceof HTMLElement) || !/opens that folder automatically/.test(helper.textContent ?? "")) throw new Error("browser-extension helper does not explain automatic folder reveal");
        if (!(install instanceof HTMLButtonElement) || !isVisible(install) || install.disabled) throw new Error("browser-extension install action is missing, hidden, or disabled");
        if (accessibleName(install) !== "Install browser extension") throw new Error("browser-extension install action has the wrong accessible name");
        if (!(search instanceof HTMLInputElement) || !(regex instanceof HTMLButtonElement)) throw new Error("Downloads Settings search or its anchored regex-builder action is missing");
        return {
          card: card.id,
          helper: helper.textContent?.replace(/\\s+/g, " ").trim() ?? "",
          installAction: accessibleName(install),
          settingsSearch: accessibleName(search),
          regexBuilderPreserved: regex.getAttribute("aria-controls")?.startsWith("settings-search-builder-") === true,
        };
      `));
      await clickByRole(cdp, "button", "Install browser extension", "#settings-browser-extension");
      await waitForPage(cdp, `(() => {
        const status = document.querySelector("#settings-browser-extension [role=status]");
        return /Installed and opened the extension folder automatically/.test(status?.textContent ?? "");
      })()`, "automatic browser-extension folder reveal status", options.timeoutMs);
      const after = await cdp.evaluate(pageExpression(`
        const card = document.getElementById("settings-browser-extension");
        const status = card?.querySelector('[role="status"]');
        const alert = card?.querySelector('[role="alert"]');
        const manual = card ? findByRole("button", "Open extension folder", card) : null;
        const install = document.getElementById("settings-install-extension");
        if (!(card instanceof HTMLElement) || !(status instanceof HTMLElement) || !isVisible(status)) throw new Error("automatic folder-reveal status is missing or hidden");
        if (status.getAttribute("aria-live") !== "polite") throw new Error("automatic folder-reveal status is not a polite live region");
        if (alert) throw new Error("successful automatic folder reveal rendered an error alert");
        if (!(manual instanceof HTMLButtonElement) || !isVisible(manual)) throw new Error("manual Open extension folder fallback is missing after install");
        if (!(install instanceof HTMLButtonElement) || install.disabled) throw new Error("install action did not leave its busy state");
        card.scrollIntoView({ block: "center", inline: "nearest" });
        const box = card.getBoundingClientRect();
        if (box.top < 0 || box.bottom > window.innerHeight) throw new Error("browser-extension card could not be framed inside the viewport");
        return {
          status: status.textContent?.replace(/\\s+/g, " ").trim() ?? "",
          live: status.getAttribute("aria-live"),
          manualFallback: accessibleName(manual),
          alert: false,
          framed: true,
          bounds: { top: box.top, bottom: box.bottom, viewportHeight: window.innerHeight },
        };
      `));
      let narrowBilingual;
      try {
        await clickByRole(cdp, "tab", "Language", '[role="dialog"]');
        await setSelectValue(cdp, "#settings-language-mode", "bilingual");
        await cdp.evaluate(`document.getElementById("settings-tab-downloads")?.click()`);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 520, height: 900, deviceScaleFactor: 2, mobile: false });
        await waitForPage(cdp, `Boolean(document.getElementById("settings-browser-extension"))`, "bilingual browser-extension card at 520px/200%", options.timeoutMs);
        narrowBilingual = await cdp.evaluate(pageExpression(`
          const dialog = document.querySelector('[role="dialog"]');
          const card = document.getElementById("settings-browser-extension");
          if (!(dialog instanceof HTMLElement) || !(card instanceof HTMLElement) || !isVisible(card)) throw new Error("bilingual browser-extension card is not visible at 520px/200%");
          card.scrollIntoView({ block: "center", inline: "nearest" });
          const overflow = {
            document: document.documentElement.scrollWidth - window.innerWidth,
            body: document.body.scrollWidth - window.innerWidth,
            dialog: dialog.scrollWidth - dialog.clientWidth,
            card: card.scrollWidth - card.clientWidth,
          };
          if (Math.max(...Object.values(overflow)) > 1) throw new Error("520px/200% bilingual browser-extension card overflows horizontally: " + JSON.stringify(overflow));
          const cardBox = card.getBoundingClientRect();
          const controls = [...card.querySelectorAll("button")].filter(isVisible);
          const outside = controls.filter((control) => {
            const box = control.getBoundingClientRect();
            return box.left < cardBox.left - 1 || box.right > cardBox.right + 1;
          });
          if (outside.length > 0) throw new Error("520px/200% browser-extension actions escape the card");
          const textNodes = [...card.querySelectorAll(".field-label,.setting-helper,.field-error")].filter(isVisible);
          const clipped = textNodes.filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1);
          if (clipped.length > 0) throw new Error("520px/200% bilingual browser-extension text is clipped: " + JSON.stringify(clipped.map((element) => normalise(element.textContent)).slice(0, 4)));
          const statusText = card.querySelector('[role="status"]')?.textContent ?? "";
          if (!/Installed and opened/.test(statusText) || !/安裝好兼自動打開/.test(statusText)) throw new Error("bilingual install/reveal status is incomplete");
          return { width: window.innerWidth, deviceScaleFactor: window.devicePixelRatio, overflow, controlsInsideCard: controls.length, clippedText: 0, bilingualStatus: true };
        `));
      } finally {
        await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
        await cdp.evaluate(`document.getElementById("settings-tab-language")?.click()`).catch(() => undefined);
        await setSelectValue(cdp, "#settings-language-mode", "english").catch(() => undefined);
        await cdp.evaluate(`document.getElementById("settings-tab-downloads")?.click()`).catch(() => undefined);
        await waitForPage(cdp, `Boolean(document.getElementById("settings-browser-extension"))`, "browser-extension card after restoring smoke metrics", options.timeoutMs).catch(() => undefined);
      }
      return { before, after, narrowBilingual };
    });

    if (options.screenshotPath) {
      const screenshot = await runCheck(result, "screenshot-captured", async () => {
        if (!cdp) throw new Error("CDP is not connected");
        await cdp.evaluate(`document.getElementById("settings-browser-extension")?.scrollIntoView({ block: "center", inline: "nearest" })`);
        await sleep(60);
        const capturedPath = await captureScreenshot(cdp, options.screenshotPath, "#settings-browser-extension");
        result.screenshot = { requested: true, status: "captured", path: capturedPath };
        return { path: capturedPath, format: "png", surface: "Downloads settings browser-extension install and automatic-reveal status" };
      });
      if (!screenshot) result.screenshot = { requested: true, status: "failed", path: options.screenshotPath };
    }

    await runCheck(result, "settings-browser-extension-manual-reveal", async () => {
      await cdp.evaluate(pageExpression(`
        const card = document.getElementById("settings-browser-extension");
        const install = document.getElementById("settings-install-extension");
        const manual = card ? findByRole("button", "Open extension folder", card) : null;
        if (!(manual instanceof HTMLButtonElement) || !(install instanceof HTMLButtonElement)) throw new Error("manual reveal controls are missing");
        manual.click();
        manual.click();
        if (/Installing/.test(install.textContent ?? "")) throw new Error("manual reveal mislabeled the install action as Installing");
      `));
      await waitForPage(cdp, `/Opened the installed extension folder/.test(document.querySelector("#settings-browser-extension [role=status]")?.textContent ?? "")`, "manual extension-folder reveal", options.timeoutMs);
      return cdp.evaluate(pageExpression(`
        const card = document.getElementById("settings-browser-extension");
        const status = card?.querySelector('[role="status"]');
        const alert = card?.querySelector('[role="alert"]');
        const install = document.getElementById("settings-install-extension");
        const manual = card ? findByRole("button", "Open extension folder", card) : null;
        if (!(status instanceof HTMLElement) || alert) throw new Error("manual reveal did not leave exactly one success outcome");
        if (!(install instanceof HTMLButtonElement) || !(manual instanceof HTMLButtonElement) || install.disabled || manual.disabled) throw new Error("manual reveal did not release the shared busy state");
        return { status: normalise(status.textContent), installAction: accessibleName(install), manualAction: accessibleName(manual), oneOutcome: true };
      `));
    });

    await runCheck(result, "settings-dialog-escape", async () => {
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "Settings dialog to close on its outer Escape path", options.timeoutMs);
      return { closed: true };
    });

    await runCheck(result, "settings-auto-organize-command-palette", async () => {
      await clickByRole(cdp, "button", "Settings");
      await waitForPage(cdp, `Boolean(document.querySelector(".dialog"))`, "Settings for Cantonese command section", options.timeoutMs);
      if (options.galleryDirectory) await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.evaluate(`document.getElementById("settings-tab-language")?.click()`);
      await setSelectValue(cdp, "#settings-language-mode", "cantonese");
      await waitForPage(cdp, `/設定/.test(document.querySelector(".dialog-header-title")?.textContent ?? "")`, "Cantonese Settings copy", options.timeoutMs);
      await cdp.evaluate(pageExpression(`
        const save = document.querySelector('.dialog-footer .btn-primary');
        if (!(save instanceof HTMLButtonElement)) throw new Error("Cantonese Settings Save action is missing");
        save.click();
      `));
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "persist Cantonese command section", options.timeoutMs);
      await cdp.evaluate(pageExpression(`
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, shiftKey: true, bubbles: true }));
      `));
      await waitForPage(cdp, `Boolean(document.querySelector('[role="dialog"].command-palette'))`, "Cantonese command palette", options.timeoutMs);
      await setInputValue(cdp, ".command-palette-input", "自動分類資料夾");
      await waitForPage(cdp, `Boolean([...document.querySelectorAll(".command-palette-row")].find((row) => /設定 · 自動分類資料夾/.test(row.textContent ?? "")))`, "Cantonese auto-organize command", options.timeoutMs);
      const localizedSection = await cdp.evaluate(pageExpression(`
        const row = [...document.querySelectorAll(".command-palette-row")].find((candidate) => /設定 · 自動分類資料夾/.test(candidate.textContent ?? ""));
        const section = row?.querySelector("em")?.textContent?.trim() ?? "";
        if (section !== "設定") throw new Error("auto-organize command section is not localized in Cantonese: " + JSON.stringify(section));
        if (!(row instanceof HTMLButtonElement)) throw new Error("Cantonese auto-organize command is not operable");
        const label = row.querySelector("strong")?.textContent?.trim() ?? "";
        row.click();
        return { label, section };
      `));
      await waitForPage(cdp, `Boolean(document.querySelector(".dialog"))`, "Cantonese command teleport for language restore", options.timeoutMs);
      await cdp.evaluate(`document.getElementById("settings-tab-language")?.click()`);
      await setSelectValue(cdp, "#settings-language-mode", "english");
      await waitForPage(cdp, `document.querySelector(".dialog-header-title")?.textContent?.trim() === "Settings"`, "English Settings copy restored", options.timeoutMs);
      await clickByRole(cdp, "button", "Save", '[role="dialog"]');
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "persist English language restore", options.timeoutMs);
      await waitForPage(cdp, `[...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Settings")`, "English global Settings action restored", options.timeoutMs);

      await cdp.evaluate(pageExpression(`
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, shiftKey: true, bubbles: true }));
      `));
      await waitForPage(cdp, `Boolean(document.querySelector('[role="dialog"].command-palette'))`, "command palette for auto-organize destination", options.timeoutMs);
      await setInputValue(cdp, 'input[aria-label="Command palette search"]', "Auto-organize folders");
      await waitForPage(cdp, `Boolean([...document.querySelectorAll(".command-palette-row")].find((row) => /Settings · Auto-organize folders/.test(row.textContent ?? "")))`, "auto-organize command-palette result", options.timeoutMs);
      await captureGallery("07-command-palette-destination", ".command-palette");
      await cdp.evaluate(pageExpression(`
        const row = [...document.querySelectorAll(".command-palette-row")]
          .find((candidate) => /Settings · Auto-organize folders/.test(candidate.textContent ?? ""));
        if (!(row instanceof HTMLButtonElement)) throw new Error("auto-organize command-palette result is missing");
        row.click();
      `));
      await waitForPage(cdp, `(() => {
        const selected = document.querySelector('[role="tablist"][aria-label="Settings sections"] [role="tab"][aria-selected="true"]');
        return Boolean(document.querySelector('[role="dialog"]')) && selected?.textContent?.trim() === "Downloads" && document.activeElement?.id === "settings-auto-organize-toggle";
      })()`, "exact auto-organize settings teleport and focus", options.timeoutMs);
      const evidence = await cdp.evaluate(pageExpression(`
        const selected = document.querySelector('[role="tablist"][aria-label="Settings sections"] [role="tab"][aria-selected="true"]');
        const target = document.getElementById("settings-auto-organize-toggle");
        if (!target || document.activeElement !== target) throw new Error("auto-organize palette destination did not focus the exact switch");
        const describedIds = (target.getAttribute("aria-describedby") ?? "").split(/\\s+/).filter(Boolean);
        const description = describedIds.map((id) => document.getElementById(id)?.textContent ?? "").join(" ").replace(/\\s+/g, " ").trim();
        if (!/Existing files are never moved/.test(description) || !/Source: compiled-in value/.test(description)) throw new Error("auto-organize switch lacks its helper/provenance accessible description: " + JSON.stringify(description));
        return { tab: selected?.textContent?.trim() ?? "", target: target.id, focused: true, description };
      `));
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "auto-organize destination Settings close", options.timeoutMs);
      await cdp.evaluate(pageExpression(`
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, shiftKey: true, bubbles: true }));
      `));
      await waitForPage(cdp, `Boolean(document.querySelector('[role="dialog"].command-palette'))`, "command palette for custom-rule destination", options.timeoutMs);
      await setInputValue(cdp, 'input[aria-label="Command palette search"]', "Custom classification rules");
      await waitForPage(cdp, `Boolean([...document.querySelectorAll(".command-palette-row")].find((row) => /Settings · Custom classification rules/.test(row.textContent ?? "")))`, "custom-rule command-palette result", options.timeoutMs);
      await cdp.evaluate(pageExpression(`
        const row = [...document.querySelectorAll(".command-palette-row")]
          .find((candidate) => /Settings · Custom classification rules/.test(candidate.textContent ?? ""));
        if (!(row instanceof HTMLButtonElement)) throw new Error("custom-rule command-palette result is missing");
        row.click();
      `));
      await waitForPage(cdp, `(() => {
        const region = document.getElementById("settings-auto-organize-rules");
        return region?.getAttribute("role") === "region" && document.activeElement === region;
      })()`, "named custom-rule region teleport and focus", options.timeoutMs);
      const rulesEvidence = await cdp.evaluate(pageExpression(`
        const selected = document.querySelector('[role="tablist"][aria-label="Settings sections"] [role="tab"][aria-selected="true"]');
        const region = document.getElementById("settings-auto-organize-rules");
        if (!(region instanceof HTMLElement) || region.getAttribute("role") !== "region") throw new Error("custom-rule destination is not a region");
        const name = accessibleName(region);
        if (name !== "Custom regex classification rules") throw new Error("custom-rule region accessible name is " + JSON.stringify(name));
        if (document.activeElement !== region) throw new Error("custom-rule palette destination did not focus the named region");
        if (selected?.textContent?.trim() !== "Downloads") throw new Error("custom-rule palette destination did not select Downloads");
        const describedIds = (region.getAttribute("aria-describedby") ?? "").split(/\\s+/).filter(Boolean);
        const description = describedIds.map((id) => document.getElementById(id)?.textContent ?? "").join(" ").replace(/\\s+/g, " ").trim();
        if (!/first match wins/i.test(description) || !/Source: persisted value/.test(description)) throw new Error("custom-rule region lacks its helper/provenance accessible description: " + JSON.stringify(description));
        return { tab: "Downloads", target: region.id, role: region.getAttribute("role"), name, focused: true, description };
      `));
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "custom-rule destination Settings close", options.timeoutMs);
      return { localizedSection, folders: evidence, customRules: rulesEvidence };
    });

    await runCheck(result, "settings-ssh-workers-surface", async () => {
      await clickByRole(cdp, "button", "Settings");
      await waitForPage(cdp, `Boolean(document.querySelector(".dialog"))`, "Settings for SSH worker surface", options.timeoutMs);
      const evidence = await cdp.evaluate(pageExpression(`
        const section = document.getElementById("settings-ssh-workers");
        const heading = document.getElementById("settings-ssh-workers-heading");
        const helper = document.getElementById("settings-ssh-workers-helper");
        const count = document.getElementById("settings-ssh-worker-count");
        const hosts = section?.querySelector('[role="list"]');
        if (!(section instanceof HTMLElement) || !(heading instanceof HTMLElement) || !(helper instanceof HTMLElement)) {
          throw new Error("SSH worker settings section is missing its heading or explanation");
        }
        if (!(count instanceof HTMLInputElement) || count.min !== "1" || count.max !== "16") {
          throw new Error("SSH worker count control is missing its bounded input contract");
        }
        if (!(hosts instanceof HTMLElement) || !hosts.getAttribute("aria-label")) throw new Error("SSH host inventory is not an accessible list");
        if (!/pinned SSH|固定 SSH/.test(helper.textContent ?? "")) throw new Error("SSH worker explanation does not describe the pinned boundary");
        return { heading: heading.textContent?.trim() ?? "", workerCount: count.value, hostListLabel: hosts.getAttribute("aria-label") ?? "", helper: helper.textContent?.trim() ?? "" };
      `));
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "SSH worker Settings close", options.timeoutMs);
      return evidence;
    });

    await runCheck(result, "settings-auto-organize-preview-ipc", async () => {
      await clickByRole(cdp, "button", "Add URL");
      await waitForPage(cdp, `Boolean(document.querySelector('[role="dialog"] .add-dl-preview'))`, "Add download preview", options.timeoutMs);
      const url = "https://example.test/releases/archive.zip?token=preview-only";
      const fileName = "podcast.mp3";
      await setInputValue(cdp, 'input[aria-label="Download URL"]', url);
      await setInputValue(cdp, 'input[aria-label="File name"]', fileName);
      await waitForPage(cdp, `document.querySelector(".add-dl-preview")?.getAttribute("data-category") === "compressed"`, "worker-backed custom-rule preview", options.timeoutMs);
      const evidence = await cdp.evaluate(pageExpression(`
        const preview = document.querySelector(".add-dl-preview");
        if (!(preview instanceof HTMLElement)) throw new Error("Add download category preview is missing");
        if (preview.getAttribute("data-category") !== "compressed") throw new Error("custom URL rule did not override the .mp3 extension in the preview");
        if (accessibleName(preview) !== "Predicted category: compressed") throw new Error("category preview has no truthful accessible name");
        return window.api.previewCategory(${JSON.stringify(fileName)}, ${JSON.stringify(url)}).then((category) => {
          if (category !== "compressed") throw new Error("real preview IPC disagrees with the rendered category");
          return { extensionCategory: "music", customRuleCategory: category, renderedCategory: preview.getAttribute("data-category") };
        });
      `));
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "Add download preview close", options.timeoutMs);
      return evidence;
    });

    await runCheck(result, "settings-reset-provenance", async () => {
      const before = await cdp.evaluate("window.api.getSettings()");
      if (before.autoOrganizeRules?.length !== 2 || before.settingProvenance?.autoOrganizeRules !== "persisted") {
        throw new Error("reset seam requires the two persisted custom rules created earlier in the smoke");
      }
      await clickByRole(cdp, "button", "Settings");
      await waitForPage(cdp, `Boolean(document.querySelector(".dialog"))`, "Settings for trusted reset", options.timeoutMs);
      await clickByRole(cdp, "tab", "Downloads", '[role="dialog"]');
      await clickByRole(cdp, "button", "Reset custom classification rules", ".auto-organize-rules");
      await waitForPage(cdp, `document.querySelectorAll(".auto-organize-rule-card").length === 0 && /Source: compiled-in value/.test(document.getElementById("settings-auto-organize-rules-source")?.textContent ?? "")`, "local reset provenance preview", options.timeoutMs);
      await clickByRole(cdp, "button", "Save", '[role="dialog"]');
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "trusted reset Save", options.timeoutMs);

      await clickByRole(cdp, "button", "Settings");
      await waitForPage(cdp, `Boolean(document.querySelector(".dialog"))`, "reopen Settings after trusted reset", options.timeoutMs);
      await clickByRole(cdp, "tab", "Downloads", '[role="dialog"]');
      const after = await cdp.evaluate("window.api.getSettings()");
      const evidence = await cdp.evaluate(pageExpression(`
        const cards = document.querySelectorAll(".auto-organize-rule-card").length;
        const source = document.getElementById("settings-auto-organize-rules-source")?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        if (cards !== 0 || source !== "Source: compiled-in value (no custom rules)") throw new Error("custom-rule reset did not survive reopen with exact compiled provenance copy");
        return { cards, source };
      `));
      if (after.autoOrganizeRules?.length !== 0 || after.settingProvenance?.autoOrganizeRules !== "compiled-in") throw new Error("main-process reset boundary did not clear value and provenance");
      if (after.defaultSaveFolder !== before.defaultSaveFolder) throw new Error("custom-rule reset changed the default folder");
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "close Settings after reset proof", options.timeoutMs);
      return { ...evidence, provenance: after.settingProvenance.autoOrganizeRules, defaultFolderPreserved: true };
    });
  } catch (error) {
    result.fatalError = result.fatalError ?? formatError(error);
    if (!cdp) markRuntimeChecksFailed(result, formatError(error));
  } finally {
    if (cdp) await cdp.close();
    const termination = await stopProcess(launch, options.timeoutMs, userDataDirectory);
    result.cleanup.processTerminated = termination.terminated;
    recordCheck(
      result,
      "process-terminated",
      termination.terminated ? "passed" : "failed",
      termination.terminated ? `terminated via ${termination.method}` : "Electron process did not terminate within the cleanup timeout",
      termination.evidence ?? termination.exit
    );
    if (result.launch && launch) {
      result.launch.processExit = termination.exit;
      const output = launch.getOutput();
      if (output.error || output.stderr.trim()) result.launch.output = { error: output.error, stderr: output.stderr.trim().slice(-4_000) };
    }

    if (fixtureServer) {
      try {
        await fixtureServer.close(Math.min(options.timeoutMs, 3_000));
        result.cleanup.fixtureServerClosed = true;
        recordCheck(result, "fixture-server-closed", "passed", "loopback fixture server closed after the Electron process stopped", { requests: fixtureServer.requests });
      } catch (error) {
        recordCheck(result, "fixture-server-closed", "failed", `loopback fixture server cleanup failed: ${formatError(error)}`, { requests: fixtureServer.requests });
      }
    } else {
      result.cleanup.fixtureServerClosed = true;
      recordCheck(result, "fixture-server-closed", "passed", "loopback fixture server was not started");
    }

    if (userDataDirectory && options.keepUserDataDirectory) {
      result.cleanup.userDataDirectoryRemoved = false;
      result.cleanup.userDataDirectory = { status: "preserved-by-option", path: userDataDirectory };
      recordCheck(result, "temp-profile-cleaned", "passed", "temporary profile preserved by explicit --keep-user-data-dir option", { path: userDataDirectory });
    } else if (userDataDirectory) {
      try {
        await removeDirectoryWithRetry(userDataDirectory);
        result.cleanup.userDataDirectoryRemoved = true;
        recordCheck(result, "temp-profile-cleaned", "passed", "temporary Electron profile removed");
      } catch (error) {
        recordCheck(result, "temp-profile-cleaned", "failed", `could not remove temporary Electron profile: ${formatError(error)}`);
      }
    } else {
      recordCheck(result, "temp-profile-cleaned", "passed", "temporary profile was not created");
    }

    if (build) {
      try {
        await clearSmokeHistoryAccess(options.appDirectory);
      } catch {
        // Credential cleanup is best effort after the app and profile are gone.
      }
    }
  }

  if (options.galleryDirectory) {
    const captured = new Set(result.gallery.items.map((item) => item.name));
    const missing = GALLERY_ITEMS.map((item) => item.name).filter((name) => !captured.has(name));
    result.gallery.status = missing.length === 0 ? "captured" : "failed";
    recordCheck(
      result,
      "screenshot-gallery-complete",
      missing.length === 0 ? "passed" : "failed",
      missing.length === 0 ? "all seven auto-organize gallery states captured" : `gallery states missing: ${missing.join(", ")}`,
      { expected: GALLERY_ITEMS.map((item) => item.name), captured: [...captured], missing },
    );
  }

  result.durationMs = Date.now() - startedAt;
  result.status = result.checks.some((check) => check.status === "failed") || result.fatalError ? "failed" : "passed";
  result.exitCode = result.status === "passed" ? 0 : 1;
  result.summary = makeSummary(result);
  if (options.jsonPath) {
    try {
      await mkdir(path.dirname(options.jsonPath), { recursive: true });
      await writeFile(options.jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    } catch (error) {
      result.status = "failed";
      result.exitCode = 1;
      result.fatalError = result.fatalError ?? `could not write JSON summary: ${formatError(error)}`;
      result.summary = makeSummary(result);
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.exitCode;
}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
