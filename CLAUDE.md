# Jot — project instructions

Keyboard-first quick-capture todo app (Electron + React + TypeScript, via
electron-vite). Personal/private project; source is public at
github.com/AidinD/jot (MIT).

If `HANDOFF.md` exists, read it FIRST — it's the latest session's current state
+ what's next (overwritten each handoff, so always small). Before making changes,
read `DECISIONS.md` (architecture rationale — the *why* behind the current shape)
and `README.md` (file-by-file layout). `INTEGRATION.md` is the external-agent
contract for `todos.json`; `BACKLOG.md` holds deferred ideas.

## Build & run

- `npm run dev` — dev build; mounts the tray and registers the global shortcut.
  Closing the window keeps the app running in the tray.
- `npm run package` — produces an NSIS Windows installer under `dist/`.

## Release

After every release, install the new build locally before handing off. The
installed Windows app is the real day-to-day runtime, so reinstalling catches
packaging and startup regressions immediately. (See DECISIONS.md, 2026-06-26.)

## Data & storage gotchas

- Runtime data is `todos.json` in the data dir. On this machine the data dir is
  overridden to `D:\Dropbox\jot` via the `JOT_DATA_DIR` env var (which also serves
  as laptop↔PC sync). The default is Electron's userData folder.
- The file is UTF-8. When editing it from a shell, preserve UTF-8 (PowerShell:
  `-Encoding UTF8`). Double-encoded å/ä/ö is a known past bug, self-healed on load
  since v0.2.7 (`repairDoubleEncoding()` in `storage.ts`).
- A sandboxed external agent's writes to `%APPDATA%` are virtualized into a private
  per-package overlay the app never sees — that is why the data dir points at a real
  path on `D:`. Verify any access/corruption claim against the user's own
  (non-spawned) app instance, not a process you launched yourself.

## Task tracking

This repo has a matching "Jot" category on the Jot board itself
(`D:\Dropbox\jot\todos.json`). Track development work there: create or claim a task
and set it to `in-progress` at the start, then move it to `review` when done —
never `done` (Aidin confirms and closes).
