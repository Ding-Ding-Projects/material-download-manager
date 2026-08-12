#!/usr/bin/env node

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const checker = path.join(root, "scripts", "check-universal-feature-inventory.mjs");
const fixtures = path.join(root, "contracts", "fixtures", "universal-feature-inventory", "complete");
let assertions = 0;

const SANITIZED_MIRROR_REQUIREMENTS = Object.freeze([
  "Every user-facing surface, including the desktop application, browser",
  "Maintain a hand-written, per-surface completeness inventory.",
  "The inventory explicitly includes the local personal-vocabulary JSON upload,",
  "Keep an executable negative regression for the inventory.",
  "Every surface owns an always-visible local personal-vocabulary JSON upload",
  "Every surface independently provides app-logo presets and a local custom",
  "Every surface independently provides a real local converter catalog and a",
  "Every rendered element supports its own opt-in toy lock and recovery route.",
  "A browser-extension capture opens a real **Start download** dialog before a",
  "The active transfer has its own IDM-style **Downloading** dialog or real",
  "The Start download dialog and non-blocking **Download complete** surface are",
  "Capture the real built artifact through the installed-extension handoff for"
]);

const PRIVATE_CONVERSATION_TERMS = Object.freeze([
  "I am dewing hui",
  "Gerk Tong Hui",
  "See Fut",
  "Chicken ai",
  "Swiftie",
  "GitHui",
  "Deen No",
  "HuiFlare",
  "Yere Dow",
  "huikey",
  "poke guy"
]);

function assertSanitizedInstructionMirror(source) {
  for (const requirement of SANITIZED_MIRROR_REQUIREMENTS) {
    assert.ok(source.includes(requirement), "AGENTS.md is missing exact sanitized instruction clause: " + requirement);
  }
  for (const term of PRIVATE_CONVERSATION_TERMS) {
    assert.ok(!source.includes(term), "AGENTS.md leaks private conversational vocabulary: " + term);
  }
}

function runChecker(args, expectedStatus, label) {
  const result = spawnSync(process.execPath, [checker, ...args], {
    cwd: root,
    encoding: "utf8"
  });
  assertions += 1;
  assert.equal(
    result.status,
    expectedStatus,
    label + "\nstdout:\n" + result.stdout + "\nstderr:\n" + result.stderr
  );
}

function sandbox() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "mdm-universal-inventory-"));
  cpSync(fixtures, directory, { recursive: true });
  return directory;
}

function productionSandbox() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "mdm-universal-inventory-production-"));
  cpSync(path.join(root, "contracts"), path.join(directory, "contracts"), { recursive: true });
  return directory;
}

function fixtureArgs(directory) {
  return [
    "--root", directory,
    "--registry", "registry.json",
    "--inventories-dir", "inventories",
    "--fixture",
    "--require-complete"
  ];
}

try {
  const sanitizedMirror = readFileSync(path.join(root, "AGENTS.md"), "utf8");
  assertSanitizedInstructionMirror(sanitizedMirror);
  assertions += SANITIZED_MIRROR_REQUIREMENTS.length + PRIVATE_CONVERSATION_TERMS.length;
  for (const requirement of SANITIZED_MIRROR_REQUIREMENTS) {
    assertions += 1;
    assert.throws(
      () => assertSanitizedInstructionMirror(sanitizedMirror.replace(requirement, "[required clause removed]")),
      /missing exact sanitized instruction clause/i,
      "Removing a required sanitized-mirror clause turns the inventory check red."
    );
  }

  runChecker([], 0, "The production inventory has valid exact structure.");
  runChecker(["--require-complete"], 1, "The production completion gate stays red until all current gaps are implemented.");

  {
    const directory = productionSandbox();
    const registryPath = path.join(directory, "contracts", "universal-feature-registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry.features = registry.features.filter((feature) => feature.id !== "personal-vocabulary-upload");
    writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
    runChecker(["--root", directory], 1, "Removing a required canonical feature from the production registry turns the checker red.");
    rmSync(directory, { recursive: true, force: true });
  }

  {
    const directory = sandbox();
    runChecker(fixtureArgs(directory), 0, "A fully anchored fixture passes the strict completion gate.");
    rmSync(directory, { recursive: true, force: true });
  }

  {
    const directory = sandbox();
    const registryPath = path.join(directory, "registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry.features = [];
    writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
    runChecker(fixtureArgs(directory), 1, "Removing an asserted registry entry turns the checker red.");
    rmSync(directory, { recursive: true, force: true });
  }

  {
    const directory = sandbox();
    const inventoryPath = path.join(directory, "inventories", "desktop.json");
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    inventory.rows = [];
    writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2) + "\n", "utf8");
    runChecker(fixtureArgs(directory), 1, "Removing a required surface row turns the checker red.");
    rmSync(directory, { recursive: true, force: true });
  }

  {
    const directory = sandbox();
    const inventoryPath = path.join(directory, "inventories", "desktop.json");
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    inventory.rows[0].featureId = "fixture-feature-renamed";
    writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2) + "\n", "utf8");
    runChecker(fixtureArgs(directory), 1, "Renaming an asserted row turns the checker red.");
    rmSync(directory, { recursive: true, force: true });
  }

  const anchorNames = [
    "IMPLEMENTATION_ANCHOR",
    "DOCUMENTATION_ANCHOR",
    "LOCALIZATION_ANCHOR",
    "PERSISTENCE_ANCHOR",
    "FOCUSED_TEST_ANCHOR",
    "BUILT_INTERACTION_ANCHOR",
    "CAPTURE_ANCHOR"
  ];
  for (const anchorName of anchorNames) {
    const directory = sandbox();
    const evidencePath = path.join(directory, "evidence", "desktop.txt");
    const evidence = readFileSync(evidencePath, "utf8");
    writeFileSync(evidencePath, evidence.replace(anchorName, anchorName + "_RENAMED"), "utf8");
    runChecker(fixtureArgs(directory), 1, "Renaming " + anchorName + " turns the checker red.");
    rmSync(directory, { recursive: true, force: true });
  }

  console.log("Universal inventory negative regression: " + assertions + "/" + assertions + " assertions passed.");
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
