# Decisions

Key decisions for Jot and the reasoning behind them. See git history and the
transcript for the step-by-step; this file is only the choices worth revisiting.

## 2026-07-18 — Split into core + UI (one repo, workspace packages)

Jot is being split into a `@jot/core` (data + logic + events) and a `@jot/ui` (React component) so that BOTH the standalone Jot shell AND a coming Jot tab inside Helm can mount the SAME implementation - "one Jot, two mounts", never two diverging copies.
Full rationale lives in Helm's docs/auto-captain-design.md + Helm DECISIONS.md "Jot and Helm: one Jot, two mounts" (the driver is Helm's auto-start feature, which needs Helm to write to the board and react live).

**One repo, workspace packages - not two repos.**
Core and UI version together and have no independent lifecycle, so separate repos would be pure overhead (multi-repo pays off for independent lifecycles/teams).
They stay in AidinD/jot as workspaces (`packages/core`, `packages/ui`, plus the standalone app shell); Helm is the separate product that consumes `@jot/core` + `@jot/ui`.
This is consistent with "Jot and Helm are separate products": core+ui are both parts of Jot; Helm consumes them.
How Helm consumes them (npm publish vs git submodule vs local path) is deferred to the integration step - Jot is public/MIT so npm is possible, but not locked now.

**The good news from the current structure:** the split mostly relocates boundaries that already exist, it isn't a rewrite.
`TodoStore` (store.ts) already has NO electron imports, takes a dependency-injected `StorageAdapter`, has a change-listener event bus, and already watches the data file to reload on external changes.
`JotApi`/`JotState` are already a defined contract, and mutations already return void with canonical state pushed via `onChanged` - so the UI is already event-driven.
The real work: (1) move types + `TodoStore` + storage into a core module with the data dir INJECTED (drop the electron `app.getPath` coupling into the shell); (2) make the UI consume an INJECTED `JotApi` instead of the hardcoded `window.jot`; (3) later, a host/client mode so one runtime writer owns the file when both apps run.

**Path: incremental, behaviour-preserving first.**
Establish clean internal module separation within this repo (app boots identically), THEN promote core+ui to workspace packages, THEN host/client. Not a big-bang restructure.

## 2026-06-22 — Initial architecture

**Stack: Electron + React + TypeScript + Vite (electron-vite).**
- Alternatives: Tauri (lighter, Rust backend), native WinUI, web app + PWA.
- Why: the global hotkey + always-on tray + frameless popover pattern needs a
  desktop runtime with a mature global-shortcut API. Electron is the team's
  proven stack (Loom, Reinmaker), so velocity wins for v1. Tauri stays a viable
  later swap — the renderer is plain React.

**v1 storage is local JSON behind a `StorageAdapter` interface.**
- Alternatives: Google Keep sync, Google Tasks API, cloud-first from day one.
- Why: Google Keep has no official API (only ToS-violating reverse-engineered
  libs) — rejected outright. Cloud-first adds auth + backend before the core
  quick-capture UX is proven. Local-first ships the valuable part now; the
  `StorageAdapter` seam (`src/main/storage.ts`) lets a Cloudflare Workers + D1
  adapter drop in later without touching the store or renderer.

**Global shortcut: `Ctrl+Alt+.`**
- Alternatives: `Win+T` (reserved by Windows — focus taskbar, can't register),
  `Ctrl+Alt+Space` (collided with another app on the user's machine).
- Why: free, ergonomic, registers reliably via Electron `globalShortcut`.

**Two BrowserWindows (main list + capture popover), not one with routing.**
- Why: the popover is frameless / transparent / always-on-top / skip-taskbar
  with very different window flags than the main window. Separate windows keep
  each one's lifecycle and styling clean. Both share one preload bridge.

**Tray-resident app; closing the main window hides it.**
- Why: quick capture must work regardless of focus, so the process and the
  registered hotkey have to stay alive even with no visible window.

**Capture window returns focus on dismiss by `hide()`-ing.**
- Why: hiding the popover lets Windows restore focus to the previously active
  app, so the user lands back where they were after pressing Enter/Esc. Good
  enough for v1; revisit if focus restoration proves flaky.

## 2026-06-22 — Categories + drag-and-drop

**Storage format went from `Todo[]` to `JotState { todos, categories }`.**
- `Todo` gained `categoryId: string | null`. `storage.ts` migrates the legacy
  bare-array file in place on load, so existing data survives the upgrade.

**State sync simplified to one source of truth.**
- Mutation IPC calls now return `void`; the canonical `JotState` always arrives
  via the `onChanged` broadcast. Only `getState` (initial load) and
  `addCategory` (returns the new id so the UI can enter rename mode) differ.
- Why: avoids two code paths (return value vs broadcast) drifting out of sync.

**Drag-and-drop uses `@dnd-kit` — reversing the earlier "native DnD" plan.**
- Alternatives: native HTML5 drag events (what I first proposed), react-dnd.
- Why: the scope grew to include in-list reordering, not just cross-list moves.
  Native HTML5 DnD makes sortable lists janky (dragover flicker, no animation,
  poor a11y). `@dnd-kit` gives smooth sortable + external droppables (the
  sidebar lists and the "new list" drop zone) in one model. One dependency,
  but it carries the core interaction of the app.

**Reorder preserves non-visible todos' positions.**
- The renderer sends only the visible *open* todo ids in their new order;
  `store.reorderTodos` refills exactly those array slots and leaves done items
  and other-category items untouched. So reordering inside a filtered list
  doesn't disturb the global ordering of everything else.

**Drag handle (⠿) instead of whole-row drag.**
- Why: a dedicated handle keeps checkbox/delete clicks unambiguous and avoids
  fighting the pointer-activation distance heuristic.

## 2026-06-25 — External integration via watched JSON

**External agents integrate directly with `todos.json`; no MCP server.**
- Alternatives: build a standalone MCP server, keep integration manual only.
- Why: Jot already has a single JSON source of truth. A live file watch plus
  an `INTEGRATION.md` contract gives Claude/Antigravity direct read/write
  access with far less complexity than a separate protocol layer.

## 2026-06-28 — Configurable data dir (`JOT_DATA_DIR`) + encoding self-heal

**Data location is configurable via the `JOT_DATA_DIR` env var; default stays userData.**
- Alternatives considered and rejected: hardcode a `Documents\Jot` or Dropbox path
  (not portable — other machines lack those paths, and not everyone has Dropbox);
  keep everything in userData with no override (blocks sandboxed external tools).
- Why: an external agent (a packaged/MSIX assistant) is sandboxed — its writes to
  `%APPDATA%` are redirected into a private per-package overlay the app never
  sees, so the two silently diverge. The fix that keeps the app portable is a
  per-machine override: default to userData (zero-config for normal installs), and
  let `JOT_DATA_DIR` point the data at a non-virtualized path the agent can also
  reach. On this developer machine it's set (User-scope env var) to `D:\Dropbox\jot`,
  which doubles as laptop↔PC sync. `Documents` was rejected as a default because it
  is OneDrive-redirected here (sync-conflict risk on a hot file).
- Migration (`migrateLegacyData`, `data-dir.ts`) copies `userData/todos.json` +
  `jot-images/` to `JOT_DATA_DIR` once if the destination has none. It must run in
  a user-launched (non-sandboxed) app instance — an instance the agent itself
  spawns inherits the sandbox and would migrate the overlay ghost, not real data.

**Verify access/corruption claims against a process you did NOT spawn.**
- The sandbox above was first wrongly dismissed: a Write-tool↔PowerShell round-trip
  "agreed," but both shared the same overlay, so it proved nothing about the real
  app. The authoritative check is the user's own app instance. Separately, a UTF-8
  *display* artifact (`Ã¥` for `å` when a terminal reads as Latin-1) was nearly
  mistaken for corruption — the bytes were correct (`C3 A5` = `å`). Check raw bytes
  / read as UTF-8 before believing the glyphs.

**`repairDoubleEncoding()` self-heals legacy double-encoded text on load (v0.2.7).**
- A real double-encoding bug did exist: an external edit wrote å/ä/ö as their
  UTF-8 bytes reinterpreted as Latin-1 code points. `storage.ts` now collapses
  `0xC2/0xC3 + continuation-byte` pairs back to the intended code point during
  normalize/migrate (todo text/description + category names), and `store.init()`
  persists once after load so the repaired file is written back on first launch.

## 2026-06-26 — Reinstall after every release

**Every new Jot release is installed locally before handoff.**
- Alternatives: only publish the GitHub release, or leave local install manual.
- Why: the installed Windows app is the real day-to-day runtime. Reinstalling
  after each release catches packaging and startup regressions immediately and
  keeps the machine in sync with the latest shipped build.

## 2026-07-04 — Real auto-update via electron-updater

**Added `electron-updater`; `checkForUpdatesAndNotify()` runs on every packaged launch.**
- Before this, Jot had no updater at all: `latest.yml` was an unused
  electron-builder byproduct and users had to reinstall manually every time.
- Wired in `src/main/index.ts` via `initAutoUpdater()`, called from inside
  `app.whenReady()` after the main window is created.
- Guarded by `app.isPackaged` so `electron-vite dev` never calls out to GitHub.
- Lifecycle events (`checking-for-update`, `update-available`,
  `update-not-available`, `error`, `download-progress`, `update-downloaded`)
  are logged to the existing `startup.log` via `logStartup()` so failures are
  visible without adding a new logging path.
- The default `checkForUpdatesAndNotify()` behavior (native notification on
  download, install on quit) is kept as-is; no forced immediate restart.

**Publish config added to `electron-builder.yml`: `provider: github`, `owner: AidinD`, `repo: jot`.**
- This is what electron-builder needs to generate a correct `latest.yml` and
  what electron-updater reads to find new releases.

**Release-naming gotcha: releases MUST be published via `electron-builder --publish`, never a manual `gh release create` upload.**
- `latest.yml` always references the installer with a DASHED filename, e.g.
  `Jot-Setup-1.5.7.exe`.
- A plain `npm run package` produces the installer with SPACES in the name
  (`Jot Setup 1.5.7.exe`), confirmed when packaging 1.5.7 locally.
- A manual `gh release create` upload commonly renames the asset with DOTS
  (`Jot.Setup.1.5.7.exe`) instead.
- Neither matches the dashed name in `latest.yml`, so electron-updater's
  download step silently fails (404 on the asset) even though the release
  "looks" published.
- The robust fix is `electron-builder --publish always` (or `onTagOrDraft`),
  which uploads the asset already renamed to match what it wrote into
  `latest.yml`. Do not hand-craft the GitHub release for a Jot version bump.

**Unsigned app: auto-update still works, first manual install still triggers SmartScreen.**
- electron-updater does not require code signing for NSIS auto-updates on
  Windows, so this is not blocking.
- The SmartScreen "Windows protected your PC" warning on first manual install
  is unrelated to auto-update and remains a known rough edge.
- Auto-update only takes effect going forward: any Jot install from before this
  change (no updater code at all, e.g. 1.5.4/1.5.5) cannot self-update to 1.5.7
  or beyond. The 1.5.7 installer must be installed manually one last time;
  every release after that can auto-update normally as long as it is published
  via `electron-builder --publish`.

## Batch reconciliation 2026-07-04 -> 07-14 (from git history)

The docs had drifted 21 commits behind the code (releases v1.5.7 -> v1.5.20).
Reconstructed from the commit history, not captured live - so it records WHAT
shipped + the clear decisions the commits show, without inventing unwritten
rationale.

**Per-list Work/Private domain field (v1.5.14).**
Each list can be tagged Work or Private; this feeds the Focus filter (below) and
is the same domain axis the Claude<->Jot integration reads. The domain chip sets
Private on first click and right-click cycles backward (v1.5.15).

**Focus filter: show lists by domain - All / Work / Private (v1.5.16).**
A top-level filter to view only work or only private lists, built on the
per-list domain field.

**Auto-update hardening (continues the auto-update thread above).**
Releases are now published DIRECTLY (`releaseType: release`), not as drafts, so
the uploaded asset name matches `latest.yml` (a hand-crafted/draft release broke
electron-updater's download - see the prior entry). Fixed a 1.5.7 launch crash
from CJS interop (default-import electron-updater). Added an in-app update toast
(v1.5.12). Added a storage POLLING fallback so external edits to the data file
reliably reload even when fs.watch misses them (v1.5.17) - important because the
data dir is Dropbox-synced and edited by other tools (Claude, Maestro).

**Capture/date-entry ergonomics.**
An `@` date-picker dropdown in the capture + add-bar inputs (v1.5.19-1.5.20);
`@deadline` accepts full English weekday names; the calendar picker opens on
click/focus of the deadline field; empty-Enter in quick capture opens the main
window.

**Look + window:** new app + tray icon (v1.5.18); a monochrome SVG folder icon
replacing the colourful emoji (v1.5.13); folder control moved into the header row
and aligned with the content column, with window-size iterations. Added a project
`CLAUDE.md` pointing at DECISIONS/README/INTEGRATION.
