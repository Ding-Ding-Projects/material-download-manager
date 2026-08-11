# History features

- [Local version history](local-version-history.md) — isolated Git-backed
  snapshots, action/date/text filters, restore, diff, and export.
- [History browser panel](renderer-history-panel.md) — the app tab that exposes
  filtered revision metadata and safe index exports without exposing snapshots;
  it is visibly locked until the local vault credential unlocks it.
- [Display-name mutation history](display-name-mutation-history.md) —
  main-process display-name writes, required hash-only audit records, rollback,
  and the boundary between UI protection and plaintext broader snapshots.
- [In-app changelog viewer](changelog-viewer.md) — embedded stable releases with
  local search, date filters, full source commit links, and filtered copy/export.
