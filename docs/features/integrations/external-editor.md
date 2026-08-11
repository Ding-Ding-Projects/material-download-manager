# External editor handoff

## Behavior

The Windows desktop application can open an exported History or Changelog file
directly in Visual Studio Code. The export still downloads normally first, so
the editor action is an additive convenience rather than the only copy of the
user's data. The selected editor is stored as an absolute local executable
path, or the application can discover `code` and `code-insiders` on `PATH` and
in the usual per-user and machine installations.

Each handoff writes UTF-8 content into a fresh, application-owned export
directory beneath the application-data folder. Visual Studio Code receives the
export directory as its workspace root and the exported file as the document
to open. A unique directory and exclusive file creation prevent an existing
file or reparse point from being followed during the write. The main process
owns all filesystem and child-process work; the renderer receives only bounded
descriptors and a success or failure result.

Settings → Advanced contains the editor selector, refresh action, native Browse
action, provenance line, and Reset action. If the selected executable is gone,
the export remains available and the notification says to choose automatic
discovery or select another executable. No editor process is launched through
a shell, and the app never downloads or installs an editor for the user.

## Configuration

Choose **Automatic discovery** to prefer a `code` or `code-insiders` command
found through `where.exe`, followed by known Visual Studio Code installation
paths. Or use **Browse…** to select a local executable or launcher. `.cmd`
launchers are accepted only when their adjacent native `Code.exe` or
`Code - Insiders.exe` can be found; the child process is then launched directly
without shell interpretation.

The setting is schema version 6 and migrates older profiles to a null editor
selection. The chosen path is a convenience setting only: app identity,
installer identity, update feeds, and application-data locations do not depend
on it.

## Failure modes and security

- Relative paths, traversal segments, control characters, unsafe export names,
  reserved Windows device names, oversized payloads, and unsupported result
  shapes fail closed at the shared validator and preload boundaries.
- A missing selected editor does not silently fall back to a different saved
  editor. The user must select Automatic discovery or choose another path.
- Export content is bounded to 2 MiB. Each export uses a fresh directory and
  exclusive file creation, then opens only that application-owned workspace.
- The native workspace picker is owned by the main process. Renderer code
  cannot ask the bridge to open an arbitrary folder path.
- Child-process errors are reduced to bounded plain text. Credentials, tokens,
  URLs with authentication, and private request headers are never sent to the
  editor bridge.
- Visual Studio Code is optional. If it is unavailable, ordinary downloads,
  clipboard actions, and the existing local export files remain usable.

The browser extension and Pages site do not claim a privileged editor bridge:
the extension has no native-messaging host, and a static browser page cannot
discover an operating-system executable or a downloaded file's absolute path.
Those surfaces keep their safe local-download fallback and explain the limit
instead of presenting a button that cannot work.

## Verification

`design/electron/__tests__/externalEditor.test.ts` covers path and filename
validation, PATH/configured discovery and deduplication, missing-editor
recovery, bounded export writes, workspace-root arguments, native `.cmd`
resolution, and the no-shell launch boundary. `persistence.test.ts` covers
schema-v6 default, migration, provenance, and rejected selection values.

The History and Changelog panels retain their normal download action and expose
**Open last export in Visual Studio Code** after a successful export. A built
desktop smoke exercises Settings → Advanced discovery/selection/reset, both
export buttons, the missing-editor notice, and a narrow bilingual layout. The
exact built-artifact capture is 534×232 pixels, 21,975 bytes, SHA-256
`92dd6a25df6e810583878a61c5cec6c98e0acebdc6a7ceb267b898cce8843057`:

![External editor Settings card showing discovery, refresh, browse, reset, and provenance](../../../screenshots/integrations/external-editor-settings.png)

## Suggested articles

- [Record export](../export/record-export.md)
- [Local version history](../history/local-version-history.md)
- [In-app documentation browser](../documentation/in-app-documentation-browser.md)
- [Regex builder](../search/regex-builder.md)
