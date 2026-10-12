import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

function replaceExactlyOnce(source: string, before: string, after: string): string {
  assert.equal(source.split(before).length - 1, 1, "mutation must target exactly one compiled safety boundary");
  return source.replace(before, after);
}

async function runFocusedTest(root: string, name: string) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await run(process.execPath, ["--test", "--test-reporter=tap", "--test-timeout=5000", `--test-name-pattern=${name}`, "electron/__tests__/handoffServer.test.js"], {
      cwd: root, env, timeout: 10_000, maxBuffer: 1_000_000,
    });
    return { code: 0, ...result };
  } catch (error) {
    const failure = error as Error & { code?: number; killed?: boolean; stdout: string; stderr: string };
    assert.equal(failure.killed, false, "a process timeout is not mutation-negative evidence");
    assert.equal(typeof failure.code, "number", "the focused runner must actually execute");
    assert.doesNotMatch(failure.stdout, /testTimeoutFailure/u, "a hanging fixture is not mutation-negative evidence");
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

test("isolated desktop handoff mutations fail and restored contracts pass", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mdm-desktop-handoff-mutations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Exercise disposable copies of the actual build. Never mutate production
  // TypeScript, the shared compiled tree, or a real pairing capability.
  await cp(path.resolve(__dirname, "../.."), root, { recursive: true });
  const sourcePath = path.join(root, "electron/extension/HandoffServer.js");
  const original = await readFile(sourcePath, "utf8");
  const mutations = [
    {
      name: "enqueueing before user confirmation",
      testName: "loopback handoff presents a pending decision",
      before: "start = pendingStart;",
      after: "start = pendingStart; await this.options.manager.addBrowserHandoff(requestToStart);",
      failure: /a pending acknowledgment must not enqueue before confirmation/u,
    },
    {
      name: "acknowledging before presentation readiness",
      testName: "loopback handoff waits for presentation readiness",
      before: "const presented = await this.options.presentPendingHandoff?.(pendingStart) ?? false;",
      after: "const presented = this.options.presentPendingHandoff?.(pendingStart) ?? false;",
      failure: /pending acknowledgment must wait for the rendered Start download window/u,
    },
    {
      name: "substituting accepted for pending acknowledgment",
      testName: "loopback handoff presents a pending decision",
      before: 'state: "pending",\n                    handoffId: pendingStart.id,',
      after: 'state: "accepted",\n                    handoffId: pendingStart.id,',
      failure: /acknowledgment must prove a pending Start download decision/u,
    },
    {
      name: "removing decision request authentication",
      testName: "loopback handoff authenticates decisions and expires",
      before: "!proofMatches(capabilityProof(capability, handoffDecisionProofInput(handoffId)), suppliedProof)",
      after: "false",
      failure: /unauthenticated polls must not disclose a decision/u,
    },
    {
      name: "releasing accepted ownership before successful rollback",
      testName: "loopback handoff authenticates rollback",
      before: 'await this.options.manager.rollbackBrowserHandoff(downloadId);\n            record.state = "rejected";\n            record.downloadId = null;',
      after: 'record.state = "rejected";\n            record.downloadId = null;\n            await this.options.manager.rollbackBrowserHandoff(downloadId);',
      failure: /failed rollback must preserve accepted ownership to prevent duplicates/u,
    },
  ];
  for (const mutation of mutations) {
    await t.test(mutation.name, async () => {
      try {
        await writeFile(sourcePath, replaceExactlyOnce(original, mutation.before, mutation.after));
        const red = await runFocusedTest(root, mutation.testName);
        assert.equal(red.code, 1, `${mutation.name} unexpectedly passed:\n${red.stdout}\n${red.stderr}`);
        assert.match(red.stdout, /# fail 1\b/u);
        assert.match(red.stdout, mutation.failure);
      } finally {
        await writeFile(sourcePath, original);
      }
      const green = await runFocusedTest(root, mutation.testName);
      assert.equal(green.code, 0, `${mutation.name} did not recover:\n${green.stdout}\n${green.stderr}`);
      assert.match(green.stdout, /# pass 1\b/u);
      assert.match(green.stdout, /# fail 0\b/u);
      t.diagnostic(`${mutation.name}: mutated boundary failed; restored boundary passed.`);
    });
  }
});
