import assert from "node:assert/strict";
import test from "node:test";
import { HistoryAccessSession } from "../history/HistoryAccessSession";

test("history access remains locked until the renderer session unlocks, and lock removes view access", () => {
  const session = new HistoryAccessSession();
  const contentId = 42;

  assert.deepEqual(session.state(contentId, false), { configured: false, unlocked: false });
  assert.deepEqual(session.state(contentId, true), { configured: true, unlocked: false });
  assert.throws(() => session.assertUnlocked(contentId), /locked/);

  session.unlock(contentId);
  assert.deepEqual(session.state(contentId, true), { configured: true, unlocked: true });
  session.assertUnlocked(contentId);

  session.lock(contentId);
  assert.deepEqual(session.state(contentId, true), { configured: true, unlocked: false });
  assert.throws(() => session.assertUnlocked(contentId), /locked/);

  session.unlock(contentId);
  session.remove(contentId);
  assert.throws(() => session.assertUnlocked(contentId), /locked/);
});

test("a configured vault cannot make an unconfigured state appear unlocked", () => {
  const session = new HistoryAccessSession();
  session.unlock(7);
  assert.deepEqual(session.state(7, false), { configured: false, unlocked: false });
});
