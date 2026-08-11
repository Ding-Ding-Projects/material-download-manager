import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("authenticator surface uses local QR rendering and keeps network out of pairing", () => {
  const panel = source("src/components/AuthenticatorPanel.tsx");
  assert.match(panel, /QRCode\.create\(/u);
  assert.match(panel, /authenticator-pairing-code/u);
  assert.match(panel, /Reveal manual secret/u);
  assert.match(panel, /confirmAuthenticatorRegistration/u);
  assert.match(panel, /registerAuthenticator/u);
  assert.match(panel, /secretOmitted: true/u);
  assert.match(panel, /otpauth URI was written/u);
  assert.doesNotMatch(panel, /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/u);
  assert.doesNotMatch(panel, /https?:\/\//u);
});

test("authenticator surface persists only validated metadata and gives a secret-free export", () => {
  const panel = source("src/components/AuthenticatorPanel.tsx");
  assert.match(panel, /isTotpRegistrationMetadata/u);
  assert.match(panel, /localStorage\.setItem\(METADATA_STORAGE_KEY, JSON\.stringify\(items\)\)/u);
  assert.match(panel, /authenticator-metadata\.json/u);
  assert.match(panel, /secretOmitted: true/u);
  assert.match(panel, /secret omitted from metadata/u);
  assert.doesNotMatch(panel, /localStorage\.[^(]+\([^\n]*secret/u);
});

test("settings exposes an authenticator tab and command-palette destination", () => {
  const settings = source("src/components/SettingsDialog.tsx");
  const app = source("src/App.tsx");
  assert.match(settings, /"authenticator"/u);
  assert.match(settings, /<AuthenticatorPanel \/>/u);
  assert.match(settings, /settings-authenticator-panel/u);
  assert.match(app, /id: "settings\.authenticator"/u);
  assert.match(app, /openSettings\("authenticator"\)/u);
});
