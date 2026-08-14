# File converter foundation

The full universal file-converter surface is not yet implemented in the
Windows desktop application. This article is deliberately present so the
offline documentation browser and product index do not imply that a converter
exists when it does not.

## Current state

The download manager can preserve downloaded files and export its own metadata
through the documented record-export routes. It does not provide a conversion
queue, format-specific preview, codec discovery, or a native file-picker flow
for converting user files. No converter button is exposed in Settings or the
command palette, and no background conversion process is started.

## Safety boundary

Until a real converter is shipped, the application makes no claims about
format support, output quality, metadata preservation, temporary-file cleanup,
or cancellation. Users should not be directed to a blank form or an online
documentation dead end from this article. Any future implementation must use a
native browse control, bounded worker process, explicit source/output paths,
progress, cancellation, failure recovery, and local history before it can be
called complete.

## Verification

The documentation bundle includes this article and its category index. The
absence of converter IPC, command-palette entries, and UI controls is an
intentional documented gap, not a passing claim that conversion works.

## Suggested articles

- [Record export](../export/record-export.md)
- [Local version history](../history/local-version-history.md)
- [Fresh-machine build](../build/fresh-machine-build.md)

[Back to product features](./README.md)
