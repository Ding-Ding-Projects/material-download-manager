import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("desktop export surfaces retain download and editor handoff actions", () => {
  const surfaces = [
    "src/components/NotificationCenter.tsx",
    "src/components/RegexBuilder.tsx",
    "src/components/AuthenticatorPanel.tsx",
  ];
  for (const surfacePath of surfaces) {
    const surface = source(surfacePath);
    assert.match(surface, /useExternalEditorExport/u, surfacePath);
    assert.match(surface, /setEditorExport/u, surfacePath);
    assert.match(surface, /Open last export in Visual Studio Code/u, surfacePath);
  }

  const notification = source("src/components/NotificationCenter.tsx");
  assert.match(notification, /downloadBlob\(fileName, content, "application\/json"\)/u);

  const regex = source("src/components/RegexBuilder.tsx");
  assert.match(regex, /dialect: "JavaScript RegExp"/u);
  assert.match(regex, /URL\.createObjectURL\(blob\)/u);

  const authenticator = source("src/components/AuthenticatorPanel.tsx");
  assert.match(authenticator, /secretOmitted: true/u);
  assert.match(authenticator, /otpauth URI was written/u);
  assert.match(authenticator, /new Blob\(\[content\]/u);
});

test("the shared handoff hook uses the privileged bridge without replacing local downloads", () => {
  const hook = source("src/hooks/useExternalEditorExport.ts");
  assert.match(hook, /window\.api\.openExportInEditor\(editorExport\.content, editorExport\.fileName\)/u);
  assert.match(hook, /Opened the exported file in Visual Studio Code/u);
  assert.match(hook, /Keep the local download or choose another editor in Settings/u);
  assert.match(hook, /setEditorMessage\(null\)/u);
  assert.doesNotMatch(hook, /result\.error/u);
  assert.doesNotMatch(hook, /shell|child_process|nativeMessaging/u);
});

test("integration documentation names all desktop surfaces and the browser boundary", () => {
  const article = fs.readFileSync(path.resolve(process.cwd(), "../docs/features/integrations/external-editor.md"), "utf8");
  for (const label of ["History", "Changelog", "NotificationCenter", "RegexBuilder", "AuthenticatorPanel"]) {
    assert.match(article, new RegExp(label, "u"));
  }
  assert.match(article, /metadata only/u);
  assert.match(article, /browser extension and Pages site do not claim a privileged editor bridge/u);
  assert.match(article, /native-messaging host/u);
});
