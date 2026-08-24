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

**Jot depends on `keel`** (github.com/AidinD/keel), the suite's shared layer,
linked as `file:../keel` — so it must be checked out at `D:\Repo\Tools\keel`.
It is a devDependency used only by the icon script; nothing from it ships in the
app.

`npm install` does **not** fail when it is missing — npm 11 links a missing
`file:` dependency to a dangling symlink and exits 0. The failure arrives later
and quieter, as `ERR_MODULE_NOT_FOUND` the first time something imports keel. So
a green install is not evidence the sibling is there.

Editing keel changes Jot immediately, with no rebuild step — that is the point
of it having no build. It also means a change there can break other siblings, so
run `npm test` in keel and regenerate the icons here (below) before assuming it
is fine.

## Release

A release is: bump the version, commit, push, THEN actually publish the build
to GitHub — pushing the commit alone does not do this, there is no CI wired up.
Publish with:

```
rm -rf dist out && npx electron-vite build && GH_TOKEN=$(gh auth token) npx electron-builder --win --publish always
```

The `electron-vite build` step is NOT optional, even though `electron-builder`
runs without complaint if you skip it — it happily packages whatever is already
sitting in `out/` from a stale previous build, silently shipping old code under
a new version number (happened 2026-08-04: v1.5.30 was published straight from
the previous day's `out/`, so none of that release's actual changes were in the
installer). Always `rm -rf dist out` first so a stale directory can't be reused
by accident.

This must be `electron-builder --publish`, never `npm run package` (produces
an unpublished local installer only) and never a manual `gh release create`
upload (wrong asset filename — see DECISIONS.md 2026-07-04 "Release-naming
gotcha"). Once published, no manual local (re)install is needed — the
installed app's `electron-updater` picks up the new version on its own next
launch. (See DECISIONS.md, 2026-08-03, superseding 2026-06-26.)

If a bad build gets published under version X, bumping to X and republishing
does NOT fix it for anyone who already auto-updated to the bad X — electron-updater
only offers an update when the version number increases. Bump to X+1 instead.

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
