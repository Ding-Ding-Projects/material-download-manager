#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

// This second hand-written list is deliberate. A registry-derived check cannot
// fail when a feature disappears from the registry itself.
const EXPECTED_CANONICAL_FEATURE_IDS = Object.freeze([
  "language-modes",
  "funny-levels",
  "emoji-toggle",
  "school-mode",
  "narration",
  "scheduled-settings",
  "external-settings-sources",
  "dim-sum-surprise",
  "regex-builder",
  "notifications",
  "appearance-editor",
  "tabs",
  "tab-locks",
  "support-tickets",
  "authenticator",
  "mutation-history",
  "landing-and-docs",
  "command-palette",
  "destructive-confirmation",
  "local-history",
  "changelog",
  "external-editor",
  "exports",
  "bulk-actions",
  "accessibility-responsive",
  "offline-documentation",
  "overlay-surfaces",
  "rich-controls",
  "guided-forms",
  "filter-collapse",
  "blank-slate-presets",
  "provider-authored-markup",
  "release-evidence",
  "local-assets-and-no-signing",
  "captures-and-evidence",
  "personal-vocabulary-upload",
  "app-logo-customization",
  "universal-file-converter",
  "ollama-suite-manager",
  "every-element-locks"
]);

const EXPECTED_SURFACE_IDS = Object.freeze(["desktop", "extension", "pages"]);
const EXPECTED_EVIDENCE_KINDS = Object.freeze([
  "implementation",
  "documentation",
  "localization",
  "persistence",
  "focusedTest",
  "builtInteraction",
  "capture"
]);
const EVIDENCE_STATES = new Set(["missing", "unverified", "partial", "implemented"]);
const ROW_STATES = new Set(["missing", "partial", "implemented"]);

const options = {
  root: repositoryRoot,
  registry: "contracts/universal-feature-registry.json",
  inventoriesDirectory: "contracts/universal-feature-inventories",
  fixture: false,
  requireComplete: false
};

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--fixture") {
    options.fixture = true;
  } else if (argument === "--require-complete") {
    options.requireComplete = true;
  } else if (argument === "--root" || argument === "--registry" || argument === "--inventories-dir") {
    const value = process.argv[index + 1];
    if (!value) {
      console.error("Missing value for " + argument);
      process.exit(2);
    }
    index += 1;
    if (argument === "--root") options.root = path.resolve(value);
    if (argument === "--registry") options.registry = value;
    if (argument === "--inventories-dir") options.inventoriesDirectory = value;
  } else {
    console.error("Unknown argument: " + argument);
    process.exit(2);
  }
}

const errors = [];
const summaries = [];

function fail(message) {
  errors.push(message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function relativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    fail(label + " must be a non-empty bounded relative path");
    return null;
  }
  const slashNormalized = value.replaceAll("\\", "/");
  if (path.isAbsolute(value) || slashNormalized.split("/").includes("..")) {
    fail(label + " must stay within the configured root");
    return null;
  }
  const resolved = path.resolve(options.root, slashNormalized);
  const relative = path.relative(options.root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(label + " escapes the configured root");
    return null;
  }
  return resolved;
}

function loadJson(relative, label) {
  const target = relativePath(relative, label);
  if (!target) return null;
  if (!existsSync(target)) {
    fail(label + " is missing: " + relative);
    return null;
  }
  try {
    return JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    fail(label + " is not valid JSON: " + relative + " (" + error.message + ")");
    return null;
  }
}

function exactStringArray(actual, expected, label) {
  if (!Array.isArray(actual)) {
    fail(label + " must be an array");
    return false;
  }
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(label + " must exactly equal [" + expected.join(", ") + "]");
    return false;
  }
  return true;
}

function exactKeys(actual, expected, label) {
  return exactStringArray(Object.keys(actual), expected, label + " keys");
}

function readEvidenceAnchor(anchor, label) {
  if (!isRecord(anchor)) {
    fail(label + " must be an object");
    return;
  }
  const kind = anchor.kind;
  if (kind !== "line" && kind !== "sha256") {
    fail(label + " must have kind line or sha256");
    return;
  }
  const expectedKeys = kind === "line" ? ["kind", "file", "lineNumber", "line"] : ["kind", "file", "sha256"];
  exactKeys(anchor, expectedKeys, label);
  const target = relativePath(anchor.file, label + " file");
  if (!target || !existsSync(target)) {
    if (target) fail(label + " file is missing: " + anchor.file);
    return;
  }
  if (kind === "line") {
    if (typeof anchor.line !== "string" || anchor.line.length === 0 || anchor.line.includes("\n") || anchor.line.includes("\r")) {
      fail(label + " line must be one non-empty exact line");
      return;
    }
    if (!Number.isInteger(anchor.lineNumber) || anchor.lineNumber < 1) {
      fail(label + " lineNumber must be a positive integer");
      return;
    }
    const lines = readFileSync(target, "utf8").replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
    if (lines[anchor.lineNumber - 1] !== anchor.line) {
      fail(label + " exact line anchor is absent, moved, or renamed: " + anchor.file + ":" + anchor.lineNumber + " :: " + anchor.line);
    }
    return;
  }
  if (typeof anchor.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(anchor.sha256)) {
    fail(label + " sha256 must be 64 lowercase hexadecimal characters");
    return;
  }
  const actualDigest = createHash("sha256").update(readFileSync(target)).digest("hex");
  if (actualDigest !== anchor.sha256) {
    fail(label + " sha256 anchor does not match: " + anchor.file);
  }
}

function validateCaptureMetadata(value, label) {
  if (!isRecord(value)) {
    fail(label + " must include captureMetadata");
    return;
  }
  exactKeys(value, ["sourceCommit", "dimensions", "surfaceLocator", "harness"], label);
  if (typeof value.sourceCommit !== "string" || !/^[0-9a-f]{7,64}$/.test(value.sourceCommit)) {
    fail(label + " sourceCommit must be a Git SHA");
  }
  if (typeof value.dimensions !== "string" || !/^[1-9]\d{0,4}x[1-9]\d{0,4}$/.test(value.dimensions)) {
    fail(label + " dimensions must use WIDTHxHEIGHT");
  }
  for (const key of ["surfaceLocator", "harness"]) {
    if (typeof value[key] !== "string" || value[key].trim().length === 0 || value[key].length > 320) {
      fail(label + " " + key + " must be a bounded non-empty string");
    }
  }
}

function validateEvidence(evidence, label) {
  if (!isRecord(evidence)) {
    fail(label + " must be an evidence object");
    return null;
  }
  exactKeys(evidence, EXPECTED_EVIDENCE_KINDS, label);
  for (const kind of EXPECTED_EVIDENCE_KINDS) {
    const record = evidence[kind];
    const recordLabel = label + "." + kind;
    if (!isRecord(record)) {
      fail(recordLabel + " must be an object");
      continue;
    }
    const expectedKeys = kind === "capture" && own(record, "captureMetadata")
      ? ["state", "anchors", "reason", "captureMetadata"]
      : ["state", "anchors", "reason"];
    exactKeys(record, expectedKeys, recordLabel);
    if (!EVIDENCE_STATES.has(record.state)) {
      fail(recordLabel + " has an invalid state");
    }
    if (!Array.isArray(record.anchors)) {
      fail(recordLabel + " anchors must be an array");
      continue;
    }
    if (record.state === "implemented" && record.anchors.length === 0) {
      fail(recordLabel + " is implemented but has no exact anchor");
    }
    if (typeof record.reason !== "string" || record.reason.trim().length === 0 || record.reason.length > 800) {
      fail(recordLabel + " must include a bounded non-empty reason");
    }
    if (kind === "capture" && record.anchors.length > 0) {
      validateCaptureMetadata(record.captureMetadata, recordLabel + ".captureMetadata");
    }
    record.anchors.forEach((anchor, index) => readEvidenceAnchor(anchor, recordLabel + ".anchors[" + index + "]"));
  }
  return evidence;
}

function resolveEvidence(row, profiles, label) {
  const hasProfile = own(row, "evidenceProfile");
  const hasInline = own(row, "evidence");
  if (hasProfile === hasInline) {
    fail(label + " must use exactly one of evidenceProfile or evidence");
    return null;
  }
  if (hasProfile) {
    if (typeof row.evidenceProfile !== "string" || !own(profiles, row.evidenceProfile)) {
      fail(label + " references an unknown evidence profile");
      return null;
    }
    return validateEvidence(profiles[row.evidenceProfile], label + ".evidenceProfiles." + row.evidenceProfile);
  }
  return validateEvidence(row.evidence, label + ".evidence");
}

function validateCompletionReference(reference, label) {
  if (typeof reference !== "string" || reference.length === 0 || reference.length > 700) {
    fail(label + " completionReference must be a bounded path plus optional anchor");
    return;
  }
  const file = reference.split("#", 1)[0];
  const target = relativePath(file, label + " completionReference");
  if (target && !existsSync(target)) {
    fail(label + " completionReference file is missing: " + file);
  }
}

const registry = loadJson(options.registry, "registry");
if (!registry || !isRecord(registry)) {
  process.exitCode = 1;
} else {
  if (registry.schemaVersion !== 1) fail("registry schemaVersion must be 1");
  if (registry.contract !== "universal-feature-inventory") fail("registry contract is invalid");
  exactStringArray(registry.surfaceIds, EXPECTED_SURFACE_IDS, "registry surfaceIds");
  exactStringArray(registry.evidenceKinds, EXPECTED_EVIDENCE_KINDS, "registry evidenceKinds");
  if (!Array.isArray(registry.features)) {
    fail("registry features must be an array");
  }
  const registryIds = Array.isArray(registry.features) ? registry.features.map((feature) => feature?.id) : [];
  if (options.fixture) {
    if (registry.fixture !== true) fail("fixture mode requires registry.fixture to be true");
  } else {
    exactStringArray(registryIds, EXPECTED_CANONICAL_FEATURE_IDS, "registry canonical feature IDs");
  }
  registry.features?.forEach((feature, index) => {
    const label = "registry.features[" + index + "]";
    if (!isRecord(feature)) {
      fail(label + " must be an object");
      return;
    }
    exactKeys(feature, ["id", "title", "source", "completion"], label);
    if (typeof feature.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(feature.id)) fail(label + " id is invalid");
    for (const key of ["title", "source", "completion"]) {
      if (typeof feature[key] !== "string" || feature[key].trim().length === 0 || feature[key].length > 800) {
        fail(label + " " + key + " must be a bounded non-empty string");
      }
    }
  });

  const inventories = [];
  for (const surfaceId of EXPECTED_SURFACE_IDS) {
    const inventory = loadJson(path.posix.join(options.inventoriesDirectory.replaceAll("\\", "/"), surfaceId + ".json"), surfaceId + " inventory");
    if (!inventory || !isRecord(inventory)) continue;
    const inventoryLabel = surfaceId + " inventory";
    if (inventory.schemaVersion !== 1) fail(inventoryLabel + " schemaVersion must be 1");
    if (inventory.contract !== "universal-feature-inventory") fail(inventoryLabel + " contract is invalid");
    if (!isRecord(inventory.surface) || inventory.surface.id !== surfaceId) fail(inventoryLabel + " surface id is invalid");
    if (!isRecord(inventory.evidenceProfiles)) fail(inventoryLabel + " evidenceProfiles must be an object");
    exactStringArray(inventory.requiredEvidenceKinds, EXPECTED_EVIDENCE_KINDS, inventoryLabel + " requiredEvidenceKinds");
    if (!Array.isArray(inventory.rows)) {
      fail(inventoryLabel + " rows must be an array");
      continue;
    }
    const rowIds = inventory.rows.map((row) => row?.featureId);
    exactStringArray(rowIds, registryIds, inventoryLabel + " feature rows");
    const profileNames = isRecord(inventory.evidenceProfiles) ? Object.keys(inventory.evidenceProfiles) : [];
    for (const profileName of profileNames) {
      validateEvidence(inventory.evidenceProfiles[profileName], inventoryLabel + ".evidenceProfiles." + profileName);
    }
    const rowRecords = [];
    inventory.rows.forEach((row, index) => {
      const label = inventoryLabel + ".rows[" + index + "]";
      if (!isRecord(row)) {
        fail(label + " must be an object");
        return;
      }
      const requiredRowKeys = ["featureId", "status", "completionReference", "note"];
      if (!requiredRowKeys.every((key) => own(row, key))) fail(label + " is missing a required row field");
      if (!ROW_STATES.has(row.status)) fail(label + " has an invalid status");
      if (typeof row.featureId !== "string" || row.featureId !== registryIds[index]) fail(label + " featureId does not match the canonical registry");
      if (typeof row.note !== "string" || row.note.trim().length === 0 || row.note.length > 1200) fail(label + " note must be a bounded non-empty string");
      validateCompletionReference(row.completionReference, label);
      const evidence = resolveEvidence(row, inventory.evidenceProfiles, label);
      if (row.status === "implemented" && own(row, "evidenceProfile")) {
        fail(label + " is implemented but uses a shared evidence profile; completed rows require row-local inline evidence");
      }
      if (row.status === "implemented") {
        for (const kind of EXPECTED_EVIDENCE_KINDS) {
          if (evidence?.[kind]?.state !== "implemented") {
            fail(label + "." + kind + " must be implemented before the row may be labelled implemented");
          }
        }
      }
      if (own(row, "evidenceProfile") && evidence && EXPECTED_EVIDENCE_KINDS.some((kind) => evidence[kind]?.state === "implemented")) {
        fail(label + " uses a shared evidence profile with implemented evidence; completed evidence must be row-local");
      }
      rowRecords.push({ row, evidence, label });
    });
    const usedAnchors = new Map();
    for (const { row, evidence, label } of rowRecords) {
      if (!evidence) continue;
      for (const kind of EXPECTED_EVIDENCE_KINDS) {
        for (const anchor of evidence[kind]?.anchors ?? []) {
          const anchorKey = kind + ":" + JSON.stringify(anchor);
          const priorFeature = usedAnchors.get(anchorKey);
          if (priorFeature && priorFeature !== row.featureId) {
            fail(label + "." + kind + " reuses exact evidence already claimed by " + priorFeature + "; each completed feature needs its own proof");
          }
          usedAnchors.set(anchorKey, row.featureId);
        }
      }
    }
    inventories.push({ surfaceId, rowRecords });
  }

  const totalRows = inventories.reduce((total, inventory) => total + inventory.rowRecords.length, 0);
  const completeRows = inventories.reduce((total, inventory) => total + inventory.rowRecords.filter(({ row, evidence }) => {
    return row.status === "implemented" && evidence && EXPECTED_EVIDENCE_KINDS.every((kind) => evidence[kind]?.state === "implemented");
  }).length, 0);
  summaries.push("Structural inventory: " + totalRows + " rows across " + inventories.length + " surfaces.");
  summaries.push("Complete rows: " + completeRows + "/" + totalRows + ".");

  if (options.requireComplete) {
    for (const inventory of inventories) {
      for (const { row, evidence, label } of inventory.rowRecords) {
        if (row.status !== "implemented") {
          fail(label + " is " + row.status + "; the completion gate requires implemented");
        }
        for (const kind of EXPECTED_EVIDENCE_KINDS) {
          if (evidence?.[kind]?.state !== "implemented") {
            fail(label + "." + kind + " is not implemented; the completion gate requires exact completed evidence");
          }
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Universal inventory check failed with " + errors.length + " error(s):");
  errors.forEach((error) => console.error("- " + error));
  process.exitCode = 1;
} else {
  summaries.forEach((summary) => console.log(summary));
  console.log(options.requireComplete
    ? "Universal completion gate: verified."
    : "Inventory structure is valid. Run with --require-complete to enforce every row's delivery evidence.");
}
