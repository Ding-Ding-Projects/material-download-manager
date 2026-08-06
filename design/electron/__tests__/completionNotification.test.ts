import assert from "node:assert/strict";
import test from "node:test";
import { notifyDownloadComplete, type CompletionNotificationOptions, type CompletionNotificationPort } from "../completionNotification";

function fakePort(supported: boolean) {
  const shown: CompletionNotificationOptions[] = [];
  const port: CompletionNotificationPort = {
    isSupported: () => supported,
    show: (options) => shown.push(options),
  };
  return { port, shown };
}

test("the compatibility setting suppresses the main-process completion notification", () => {
  const { port, shown } = fakePort(true);

  assert.equal(
    notifyDownloadComplete({ fileName: "report.pdf" }, { showCompleteDialog: false }, port),
    false
  );
  assert.deepEqual(shown, []);
});

test("enabled completion notification is non-blocking and carries the file name", () => {
  const { port, shown } = fakePort(true);

  assert.equal(
    notifyDownloadComplete({ fileName: "report.pdf" }, { showCompleteDialog: true }, port, "icon.ico"),
    true
  );
  assert.deepEqual(shown, [{ title: "Download complete", body: "report.pdf", icon: "icon.ico" }]);
});

test("unsupported native notifications fail closed", () => {
  const { port, shown } = fakePort(false);

  assert.equal(
    notifyDownloadComplete({ fileName: "report.pdf" }, { showCompleteDialog: true }, port),
    false
  );
  assert.deepEqual(shown, []);
});
