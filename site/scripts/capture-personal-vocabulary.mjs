import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing ${name}.`);
  }
  return process.argv[index + 1];
}

function createClient(endpoint) {
  let nextId = 1;
  const pending = new Map();
  const socket = new WebSocket(endpoint);

  const opened = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out opening the local DevTools connection.")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not open the local DevTools connection."));
    }, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  return {
    async open() {
      await opened;
    },
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}.`));
        }, 10_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

const port = Number(readFlag("--port"));
const expectedUrl = new URL(readFlag("--url")).href;
const outputPath = path.resolve(readFlag("--output"));

if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  throw new Error("The DevTools port must be a user-port number.");
}

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(async (response) => {
  if (!response.ok) throw new Error(`The local DevTools list returned ${response.status}.`);
  return response.json();
});

if (targets.length !== 1 || targets[0]?.type !== "page" || new URL(targets[0]?.url).href !== expectedUrl || !targets[0]?.webSocketDebuggerUrl) {
  throw new Error("The hidden browser did not expose exactly the expected local page.");
}

const client = createClient(targets[0].webSocketDebuggerUrl);
try {
  await client.open();
  const state = await client.request("Runtime.evaluate", {
    expression: `(() => {
      const settings = document.querySelector('[data-tab="settings"]');
      const card = document.querySelector('#personal-vocabulary-card');
      const picker = document.querySelector('#personal-vocabulary-file');
      const choose = document.querySelector('#personal-vocabulary-upload');
      const replace = document.querySelector('#personal-vocabulary-replace');
      const clear = document.querySelector('#personal-vocabulary-clear');
      const status = document.querySelector('#personal-vocabulary-status');
      settings?.click();
      card?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = card?.getBoundingClientRect();
      return {
        noFileValue: picker?.value === '',
        visible: Boolean(card && !card.hidden && rect && rect.width > 0 && rect.height > 0),
        controls: [choose, replace, clear].every((control) => Boolean(control && !control.disabled)),
        status: status?.textContent?.trim() || '',
        rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      };
    })()`,
    returnByValue: true,
    awaitPromise: false,
  });

  const value = state?.result?.value;
  if (!value?.noFileValue || !value.visible || !value.controls || !value.rect) {
    throw new Error("The generic no-file settings state was not ready for capture.");
  }

  const clip = {
    x: Math.max(0, Math.floor(value.rect.left - 20)),
    y: Math.max(0, Math.floor(value.rect.top - 20)),
    width: Math.ceil(value.rect.width + 40),
    height: Math.ceil(value.rect.height + 40),
    scale: 1,
  };
  const image = await client.request("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(image.data, "base64"));
  process.stdout.write(`${JSON.stringify({ outputPath, width: clip.width, height: clip.height, status: value.status })}\n`);
} finally {
  client.close();
}
