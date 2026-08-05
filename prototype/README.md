# Preserved Material Design Prototype

This directory preserves the Material Design prototype that previously occupied
the repository's `design/` path. It remains useful as a visual and interaction
reference, but it is not the production Electron application.

The prototype uses a custom template format (`.dc.html`) and the adjacent
`support.js` runtime. Keep the relative directory structure intact when opening
it through its original host. `js/engine.js` is a deterministic simulation used
to drive the mockup; it must not be used as the application's real download
engine.

The runnable application is under [`../design/`](../design/). The reconciliation
and remaining verification work are recorded in [`../HANDOFF.md`](../HANDOFF.md).
