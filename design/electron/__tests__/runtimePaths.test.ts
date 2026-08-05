import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { isDevelopmentLaunch, resolveRendererPath } from "../runtimePaths";

test("compiled main resolves the Vite renderer beside dist-electron", () => {
  const compiledMainDirectory = path.join("repo", "design", "dist-electron", "electron");
  const expected = path.join("repo", "design", "dist", "index.html");

  assert.equal(resolveRendererPath(compiledMainDirectory), expected);
});

test("only an explicit development environment enables the dev server", () => {
  assert.equal(isDevelopmentLaunch(false, "development"), true);
  assert.equal(isDevelopmentLaunch(false, undefined), false);
  assert.equal(isDevelopmentLaunch(true, "development"), false);
});
