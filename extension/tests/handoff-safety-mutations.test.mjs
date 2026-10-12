import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function replaceExactlyOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, "mutation must target exactly one current safety boundary");
  return source.replace(before, after);
}

async function runFocusedTest(root, name) {
  const env = { ...process.env };
  // The child is an independent runner, not another worker of this node:test
  // process. Inheriting this marker makes Node skip its tests recursively.
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await run(process.execPath, ["--test", "--test-reporter=tap", `--test-name-pattern=${name}`, "tests/extension.test.mjs"], {
      cwd: root,
      env,
      timeout: 20_000,
      maxBuffer: 1_000_000,
    });
    return { code: 0, ...result };
  } catch (error) {
    assert.equal(error.killed, false, "a timeout is not mutation-negative evidence");
    assert.equal(typeof error.code, "number", "the focused test must actually execute");
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("isolated handoff safety mutations fail and restored boundaries pass", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mdm-handoff-safety-mutations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Mutate only disposable copies. The repository's public pairing module and
  // production sources are never written by these tests.
  await cp(extensionRoot, root, { recursive: true });
  const mutations = [
    {
      name: "removing alarms permission",
      file: "manifest.json",
      testName: "MV3 manifest declares",
      failure: /alarms/u,
      mutate: (source) => {
        const manifest = JSON.parse(source);
        assert.equal(manifest.permissions.includes("alarms"), true);
        manifest.permissions = manifest.permissions.filter((permission) => permission !== "alarms");
        return JSON.stringify(manifest);
      },
    },
    {
      name: "replacing compiled pairing with stored capability",
      file: "src/service-worker.js",
      testName: "unpaired public worker",
      failure: /public worker did not report its missing compiled pairing/u,
      mutate: (source) => replaceExactlyOnce(source,
        "const capability = preparedHandoffCapability();",
        "const capability = await readHandoffCapability();"),
    },
    {
      name: "removing mandatory pending acknowledgment",
      file: "src/service-worker.js",
      testName: "service worker runtime boundary",
      failure: /missing-pending must not replace a pending Start download acknowledgment/u,
      mutate: (source) => replaceExactlyOnce(source,
        '      responseBody.state !== "pending" ||\n',
        ""),
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, async () => {
      const path = join(root, mutation.file);
      const original = await readFile(path, "utf8");
      try {
        await writeFile(path, mutation.mutate(original));
        const red = await runFocusedTest(root, mutation.testName);
        assert.equal(red.code, 1, `${mutation.name} unexpectedly passed:\n${red.stdout}\n${red.stderr}`);
        assert.match(red.stdout, /# fail 1\b/u);
        assert.match(red.stdout, mutation.failure);
      } finally {
        await writeFile(path, original);
      }
      const green = await runFocusedTest(root, mutation.testName);
      assert.equal(green.code, 0, `${mutation.name} did not recover after restoration:\n${green.stdout}\n${green.stderr}`);
      assert.match(green.stdout, /# pass 1\b/u);
      assert.match(green.stdout, /# fail 0\b/u);
      t.diagnostic(`${mutation.name}: mutated boundary failed; restored boundary passed.`);
    });
  }
});
