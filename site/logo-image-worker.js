"use strict";

// A dedicated, same-origin worker keeps byte inspection and image decode out of
// the interactive settings surface. It has no network API usage or import path
// other than the bundled local contract below.
importScripts("./data/logo-customization-contract.js");

// The document CSP enforces connect-src 'none' and worker-src 'self'. Lock the
// worker's own network-capable globals after its one bundled import so a later
// change cannot silently turn image validation into an outbound route.
const offlineOnly = () => { throw new Error("Logo validation worker is local-only."); };
Object.defineProperties(self, {
  fetch: { value: offlineOnly, configurable: false, writable: false },
  importScripts: { value: offlineOnly, configurable: false, writable: false },
  XMLHttpRequest: { value: undefined, configurable: false, writable: false },
  WebSocket: { value: undefined, configurable: false, writable: false },
  EventSource: { value: undefined, configurable: false, writable: false }
});

self.addEventListener("message", async (event) => {
  const payload = event.data && typeof event.data === "object" ? event.data : {};
  if (payload.kind !== "validate-logo-image") return;
  try {
    const bytes = new Uint8Array(payload.bytes);
    const inspected = self.MDM_SITE_LOGO_CONTRACT.inspectImageBytes(bytes);
    if (!inspected.valid) {
      self.postMessage({ ok: false, reason: inspected.reason });
      return;
    }
    if (typeof createImageBitmap !== "function") {
      self.postMessage({ ok: false, reason: "isolated-decoder-unavailable" });
      return;
    }
    const bitmap = await createImageBitmap(new Blob([bytes], { type: inspected.mime }), {
      imageOrientation: "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none"
    });
    const dimensionsMatch = bitmap.width === inspected.width && bitmap.height === inspected.height;
    bitmap.close();
    self.postMessage(dimensionsMatch ? { ok: true, descriptor: inspected } : { ok: false, reason: "decoder-dimensions-mismatch" });
  } catch (_error) {
    self.postMessage({ ok: false, reason: "decoder-rejected" });
  }
});
