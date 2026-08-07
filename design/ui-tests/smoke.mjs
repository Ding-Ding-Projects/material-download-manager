#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CHILD_OUTPUT = 16_384;
const RUNTIME_CHECK_IDS = [
  "resolve-cdp-page",
  "cdp-connected",
  "renderer-root-mounted",
  "feature-surface-mounted",
  "history-panel",
  "progress-window",
  "settings-open",
  "settings-dialog-a11y",
  "settings-narrow-layout",
  "settings-tabs",
  "settings-search-control",
  "settings-search-interaction",
  "settings-regex-builder",
  "escape-closes-builder-and-restores-focus",
  "settings-dialog-escape",
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
    "  --screenshot <path>    Capture a PNG while the Settings regex builder is open",
    "  --progress-screenshot <path>  Capture a separate progress page when one exists",
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
    screenshotPath: null,
    progressScreenshotPath: null,
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
    else if (argument === "--screenshot") options.screenshotPath = path.resolve(value);
    else if (argument === "--progress-screenshot") options.progressScreenshotPath = path.resolve(value);
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

  const environment = { ...process.env, NODE_ENV: "production" };
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
    return String(value ?? "").replace(/\\s+/g, " ").trim();
  }
  function accessibleName(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return normalise(ariaLabel);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelledText = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
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

async function dispatchEscape(client) {
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
}

async function captureScreenshot(client, screenshotPath) {
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  const response = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  if (typeof response.data !== "string" || response.data.length === 0) throw new Error("CDP returned no screenshot data");
  await writeFile(screenshotPath, Buffer.from(response.data, "base64"));
  await requireNonEmptyFile(screenshotPath, "captured screenshot");
  return screenshotPath;
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

async function stopProcess(launch, timeoutMs) {
  if (!launch) return { terminated: true, method: "not-started", exit: null };
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
  const result = createResult(options);
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

    port = await allocateLoopbackPort(options.port);
    userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "material-download-manager-ui-smoke-"));
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
      const evidence = await cdp.evaluate(pageExpression(`
        const panel = document.querySelector(".history-panel");
        const search = document.querySelector('input[aria-label="Search history"]');
        const dates = document.querySelectorAll('.history-panel input[type="date"]');
        const exportButton = findByRole("button", "Export filtered history");
        const tab = document.querySelector('[role="tablist"][aria-label="Open tabs"] [role="tab"][aria-selected="true"]');
        if (!panel || !isVisible(panel) || !search || !isVisible(search)) throw new Error("History panel or search is missing or hidden");
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

    await runCheck(result, "settings-open", async () => {
      await clickByRole(cdp, "button", "Settings");
      await waitForPage(cdp, `Boolean(document.querySelector(".dialog"))`, "Settings dialog surface", options.timeoutMs);
      return cdp.evaluate(pageExpression(`
        const dialog = document.querySelector(".dialog");
        if (!dialog || !isVisible(dialog)) throw new Error("Settings dialog is not visible after activating Settings");
        return { className: dialog.className, visible: true };
      `));
    });

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

    await runCheck(result, "settings-narrow-layout", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 520, height: 720, deviceScaleFactor: 2, mobile: false });
      try {
        const tabNames = ["Language", "Appearance", "Downloads", "Advanced"];
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
            const visibleGrids = [...panel.querySelectorAll(".field-pair,.settings-level-grid")].filter(isVisible);
            const wideGrids = visibleGrids.filter((grid) => getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length > 1);
            if (wideGrids.length > 0) throw new Error("narrow Settings viewport kept a multi-column grid: " + wideGrids.map((grid) => grid.className).join(", "));
            const unnamedControls = [...panel.querySelectorAll("input,select,textarea,button")]
              .filter(isVisible)
              .map((control) => ({ id: control.id, tag: control.tagName.toLowerCase(), name: accessibleName(control) }))
              .filter((control) => !control.name);
            if (unnamedControls.length > 0) throw new Error("narrow Settings tab contains unnamed controls: " + JSON.stringify(unnamedControls));
            return { panel: panel.id, horizontalOverflow, singleColumnGrids: visibleGrids.length, unnamedControls: 0 };
          `)));
        }
        await clickByRole(cdp, "tab", "Language", '[role="dialog"]');
        await waitForPage(cdp, 'document.querySelector(\'[role="tablist"][aria-label="Settings sections"] [role="tab"][aria-selected="true"]\')?.textContent?.trim() === "Language"', "restore Language settings tab", options.timeoutMs);
        return { innerWidth: 520, innerHeight: 720, deviceScaleFactor: 2, panels };
      } finally {
        await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
      }
    });

    await runCheck(result, "settings-tabs", async () => {
      const initial = await cdp.evaluate(pageExpression(`
        const tabList = document.querySelector('[role="tablist"][aria-label="Settings sections"]');
        const tabs = tabList ? [...tabList.querySelectorAll('[role="tab"]')] : [];
        const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
        const panelId = selected[0]?.getAttribute("aria-controls");
        const panel = panelId ? document.getElementById(panelId) : null;
        if (!tabList || tabs.length !== 4) throw new Error("Settings surface must expose four browser-style tabs");
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
      await waitForPage(cdp, `Boolean(document.querySelector('section[aria-label$="regex builder"]'))`, "Settings regex builder", options.timeoutMs);
      return cdp.evaluate(pageExpression(`
        const builder = document.querySelector('section[aria-label$="regex builder"]');
        const row = document.querySelector(".settings-search-row");
        const toggle = row ? findByRole("button", "Regex", row) : null;
        const modeGroup = builder?.querySelector('[role="radiogroup"][aria-label="Search mode"]');
        const radios = builder ? builder.querySelectorAll('input[type="radio"]') : [];
        const pattern = builder?.querySelector('input.regex-pattern');
        if (!builder || !isVisible(builder)) throw new Error("Settings regex builder is missing or hidden");
        if (!modeGroup || radios.length < 2) throw new Error("Settings regex builder is missing its accessible search-mode radio group");
        if (!(pattern instanceof HTMLInputElement)) throw new Error("Settings regex builder is missing its pattern editor");
        if (!toggle || toggle.getAttribute("aria-expanded") !== "true") throw new Error("Settings Regex toggle did not expose aria-expanded=true");
        return { visible: true, modeGroup: accessibleName(modeGroup), radioCount: radios.length, patternInput: true, expanded: true };
      `));
    });

    if (options.screenshotPath) {
      const screenshot = await runCheck(result, "screenshot-captured", async () => {
        if (!cdp) throw new Error("CDP is not connected");
        const capturedPath = await captureScreenshot(cdp, options.screenshotPath);
        result.screenshot = { requested: true, status: "captured", path: capturedPath };
        return { path: capturedPath, format: "png" };
      });
      if (!screenshot) result.screenshot = { requested: true, status: "failed", path: options.screenshotPath };
    }

    await runCheck(result, "escape-closes-builder-and-restores-focus", async () => {
      await dispatchEscape(cdp);
      await waitForPage(
        cdp,
        `(() => {
          const builderClosed = !document.querySelector('section[aria-label$="regex builder"]');
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
        return { expanded: false, focusRestored: true };
      `));
    });

    await runCheck(result, "settings-dialog-escape", async () => {
      await dispatchEscape(cdp);
      await waitForPage(cdp, `!document.querySelector(".dialog")`, "Settings dialog to close on its outer Escape path", options.timeoutMs);
      return { closed: true };
    });
  } catch (error) {
    result.fatalError = result.fatalError ?? formatError(error);
    if (!cdp) markRuntimeChecksFailed(result, formatError(error));
  } finally {
    if (cdp) await cdp.close();
    const termination = await stopProcess(launch, options.timeoutMs);
    result.cleanup.processTerminated = termination.terminated;
    recordCheck(
      result,
      "process-terminated",
      termination.terminated ? "passed" : "failed",
      termination.terminated ? `terminated via ${termination.method}` : "Electron process did not terminate within the cleanup timeout",
      termination.exit
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
