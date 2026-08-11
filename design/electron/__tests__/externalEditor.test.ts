import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isExternalEditorDiscovery,
  isExternalEditorOpenResult,
  isSafeAbsolutePath,
  isSafeExportFileName,
} from "../../shared/externalEditor";
import { ExternalEditorService } from "../externalEditor/ExternalEditorService";

async function tempDirectory(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "mdm-external-editor-"));
}

test("external editor validators reject traversal, controls, and unsafe export names", () => {
  assert.equal(isSafeAbsolutePath("C:\\Users\\Example\\Code.exe"), true);
  assert.equal(isSafeAbsolutePath("C:\\Users\\..\\Code.exe"), false);
  assert.equal(isSafeAbsolutePath("relative\\Code.exe"), false);
  assert.equal(isSafeExportFileName("history.json"), true);
  assert.equal(isSafeExportFileName("../history.json"), false);
  assert.equal(isSafeExportFileName("CON.txt"), false);
  assert.equal(isSafeExportFileName("bad\u0000.json"), false);
  assert.equal(isSafeExportFileName("x".repeat(161) + ".json"), false);
});

test("editor discovery deduplicates PATH and configured Code.exe candidates", async () => {
  const root = await tempDirectory();
  const executable = path.join(root, "Code.exe");
  await fsp.writeFile(executable, "native editor fixture");
  const service = new ExternalEditorService(root, {
    which: async () => executable,
    fileExists: async (candidate) => candidate === executable,
    environment: {},
  });
  const result = await service.discover(executable);
  assert.equal(isExternalEditorDiscovery(result), true);
  assert.equal(result.editors.length, 1);
  assert.equal(result.editors[0]?.source, "configured");
  assert.equal(result.selectedExecutable, executable);
});

test("export handoff writes a bounded file and opens its export folder as the workspace root", async () => {
  const root = await tempDirectory();
  const executable = path.join(root, "Code.exe");
  await fsp.writeFile(executable, "native editor fixture");
  const launches: Array<{ executable: string; args: string[] }> = [];
  const service = new ExternalEditorService(root, {
    which: async () => null,
    fileExists: async (candidate) => candidate === executable,
    launch: async (candidate, args) => { launches.push({ executable: candidate, args }); },
    environment: {},
  });
  const result = await service.openExport("{\"ok\":true}\n", "records.json", executable);
  assert.equal(isExternalEditorOpenResult(result), true);
  assert.equal(result.opened, true);
  assert.ok(result.filePath && result.workspacePath);
  assert.equal(result.workspacePath, path.join(root, "exports"));
  assert.ok(result.filePath!.startsWith(result.workspacePath! + path.sep));
  assert.equal(await fsp.readFile(result.filePath!, "utf8"), "{\"ok\":true}\n");
  assert.deepEqual(launches, [{ executable, args: ["--reuse-window", result.workspacePath!, result.filePath!] }]);
});

test("cmd launcher resolves to native Code.exe and never invokes a shell", async () => {
  const root = await tempDirectory();
  const bin = path.join(root, "bin");
  await fsp.mkdir(bin);
  const launcher = path.join(bin, "code.cmd");
  const executable = path.join(root, "Code.exe");
  await fsp.writeFile(launcher, "echo fixture");
  await fsp.writeFile(executable, "native editor fixture");
  let launched = "";
  const service = new ExternalEditorService(root, {
    which: async () => null,
    fileExists: async (candidate) => candidate === launcher || candidate === executable,
    launch: async (candidate) => { launched = candidate; },
    environment: {},
  });
  const result = await service.openExport("hello\n", "notes.md", launcher);
  assert.equal(result.opened, true);
  assert.equal(launched, executable);
});

test("workspace handoff opens the native folder as the editor workspace root", async () => {
  const root = await tempDirectory();
  const workspace = path.join(root, "workspace");
  const executable = path.join(root, "Code.exe");
  await fsp.mkdir(workspace);
  await fsp.writeFile(executable, "native editor fixture");
  const launches: Array<{ executable: string; args: string[] }> = [];
  const service = new ExternalEditorService(root, {
    which: async () => null,
    fileExists: async (candidate) => candidate === executable,
    directoryExists: async (candidate) => candidate === workspace,
    launch: async (candidate, args) => { launches.push({ executable: candidate, args }); },
    environment: {},
  });
  const result = await service.openWorkspace(workspace, executable);
  assert.equal(result.opened, true);
  assert.deepEqual(launches, [{ executable, args: ["--reuse-window", workspace] }]);
});

test("missing selected editor fails clearly instead of silently choosing another editor", async () => {
  const root = await tempDirectory();
  const selected = path.join(root, "missing-code.exe");
  const service = new ExternalEditorService(root, {
    which: async () => null,
    fileExists: async () => false,
    environment: {},
  });
  const result = await service.openExport("hello", "notes.txt", selected);
  assert.equal(result.opened, false);
  assert.match(result.error ?? "", /selected editor is unavailable/u);
});

test("missing editor leaves the normal export path available", async () => {
  const root = await tempDirectory();
  const service = new ExternalEditorService(root, { which: async () => null, fileExists: async () => false, environment: {} });
  const result = await service.openExport("hello", "notes.txt");
  assert.equal(result.opened, false);
  assert.match(result.error ?? "", /Visual Studio Code was not found/u);
});
