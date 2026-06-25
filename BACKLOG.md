# Backlog

Deferred ideas, not scheduled. See `DECISIONS.md` for decisions already made.

## Closed: Cross-device sync via Google Tasks

This was parked while we tested the lighter JSON integration path. Jot now
uses `todos.json` as the external integration surface, so a full Google Tasks
sync is not needed right now.

### Notes preserved

- Opt-in would have kept the app local-first by default.
- Local JSON would have stayed the source of truth.
- Mobile would have been the Google Tasks app, not a Jot app.
- Category mapping would have needed a stable id table.

## Auto-update via GitHub

Like Loom — needs `latest.yml` plus an `electron-builder` publish config and a
release-upload step. Optional.
