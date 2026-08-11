# Fresh-machine build

This category documents the repository's touchless Windows build entry points.
They bootstrap the declared toolchain, build the runnable application, and
produce the same intentionally unsigned Squirrel.Windows installer used by the
supported release path. The scripts are local build tools: they never create a
tag, publish a release, upload an asset, or produce a CRX.

## Articles

- [Fresh-machine build contract](fresh-machine-build.md) — user-scoped
  bootstrap, silent operation, reproducible application output, and unsigned
  installer validation.

## Verification

The committed contract check exercises both batch entry points from an
arbitrary working directory, including a path containing spaces. It also
deliberately removes required markers and changes the lockfile version to prove
that the guard turns red for broken fixtures. A full local run uses
`build.bat /s` followed by `build-installer.bat /s`; the latter reports the
installer paths, sizes, SHA-256 digests, source commit, and `NotSigned` status.
