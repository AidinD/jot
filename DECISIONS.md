# Decisions

Key decisions for Jot and the reasoning behind them. See git history and the
transcript for the step-by-step; this file is only the choices worth revisiting.

## 2026-08-23 — Open ring stays, and the icon becomes a generated multi-size .ico

Four candidate marks were drawn up (Iota, a written tick, a jotted list, and a
refined version of the existing circle-and-tick). Aidin picked the refinement,
**Open ring**, and the reasoning that settled it is worth keeping:

- At 16px it is the only one of the four with a *silhouette*. The others reduce
  to a diagonal stroke, which half the taskbar already looks like. An app icon
  at that size is not there to explain the app, it is there to be found.
- The "namesake" argument the other three were built on is weaker than it looks.
  Helm and Nib are nouns for physical objects; **Jot is a verb**, so there is no
  equivalent object to draw. The closest thing to "a jot" is the dot itself,
  which is why Iota is the one to revisit if this ever becomes a real rebrand.

**The soft tray mark was never the drawing.** `scripts/generate-icon.mjs` had
gone stale — it still rendered the pre-1.0 blue rounded square, while the coral
mark in `resources/icon.png` had been dropped in by hand, so running the script
would have silently reverted the app icon. And Jot shipped a *single* PNG, which
Windows resampled down to 16px for the tray.

Rewritten on Nib's generator (same dependency-free PNG and ICO writers, same
distance-field rendering — two apps, one icon pipeline):

- The geometry is taken from `JotMark.tsx`, the header component, so the mark
  beside the wordmark and the mark in the taskbar are one drawing.
- Two drawings, per the family rule: the full mark at 32px and up, and below
  that a heavier ring with a wider bite and a shorter tick. Measured, not
  guessed — at 16px the true 9-unit stroke lands under a pixel and the counter
  inside the ring closes up, which is exactly the blob that shipped.
- One `icon.ico` carrying 16/20/24/32/48/64/128/256, used for both the packaged
  app and the tray. A tray-only .ico topping out at 32 was tried and rejected:
  on Windows `nativeImage.createFromPath` reports a 256px bitmap for *any* .ico,
  so a small-only file gets upscaled before anything else happens. Carrying
  every size means whichever path Windows takes it finds a real drawing.
- 20 and 24 are in there because the tray asks for them at 125% and 150%
  display scaling — the two scales where a missing frame means a resample.

Verified by decoding the generated `.ico` (all eight frames present and drawn,
not resampled) and by loading it through Electron's `nativeImage`. The tray icon
as Windows finally paints it was *not* verified on screen — it sits in the
notification-area overflow here, and driving that flyout meant screenshotting
parts of the desktop, which is not worth it for a look.

## 2026-08-23 — Frameless window with a Nib-style header, and a pinned-todos desktop panel

Two board tasks, both shaped by the same idea: Jot and Nib should read as one
family (Nib already borrows Jot's design tokens verbatim — see Nib's DECISIONS
2026-08-19), and Nib's sticky-note window was the obvious precedent for putting
todos on the desktop.

**Frameless main window.** The native title bar is gone; the app header row is
the title bar, carrying the drag region and its own minimise / maximise /
close-to-tray buttons, exactly like Nib's. The 16px padding moved off `.app`
onto `.app-header` and `.body` so the drag region reaches the top edge of the
window rather than starting 16px in.

- The window buttons and the drag region are gated on `IS_FRAMELESS_SHELL`
  (`typeof window.jot?.minimizeWindow === 'function'`), the same feature-detect
  pattern the update toast already uses. Helm mounts Jot's *built renderer* in a
  webview with its own `window.jot` bridge (jot-webview-preload.cjs), so without
  the gate the embedded board would grow window buttons for Helm's window. The
  drag region is gated too, via an `.app.framed` class.
- Close goes through the normal `window.close()` path, which the main window
  already intercepts to hide into the tray — so ✕ still means "close to tray",
  not "quit".

**Pinned todos on the desktop.** `Todo.pinned` (a boolean on the todo, not a
separate list) drives a small always-on-top frameless panel, off the taskbar.

- Chosen over one window per pinned todo (Nib's sticky model) because the task
  said "a way of showcasing — this is what I want to get done today": that is
  one shortlist, not N floating cards.
- **The panel exists exactly while something is pinned.** No show/hide toggle to
  keep in sync with the data, and the panel disappears on its own once the list
  is empty. It is created lazily then hidden (never destroyed), so its position
  survives an empty stretch; the position itself lives in `prefs.json`.
- **Finishing a todo unpins it** (in `setStatus`), so ticking things off empties
  the panel instead of leaving a done pile that needs a separate cleanup pass.
- `setTodoPinned` is **optional** on `JotApi`. Helm's webview preload is a
  hand-maintained byte-mirror of Jot's bridge in a separate repo; a required
  method would break the embedded board until that file is updated. The UI hides
  the pin control when the host doesn't provide it.
- `setTodoPinned` deliberately does not touch `updatedAt` — pinning says where a
  todo is *shown*, not that the todo changed, and bumping it would churn the
  "date" sort.

## 2026-08-04 — Publish command must rebuild first; a same-version republish doesn't fix a bad release

v1.5.30 was published by running `electron-builder --win --publish always`
directly, per CLAUDE.md's documented command at the time. That command never
rebuilds — `electron-builder` packages whatever is already in `out/`, so it
silently shipped the *previous day's* renderer build (2026-08-03 19:16) under
the 1.5.30 tag. Aidin's app auto-updated to it and none of the intended
1.5.30 changes were actually present; he reported the fixes "don't work" and
that's how it surfaced.

Two things fixed:
- CLAUDE.md's publish command is now `rm -rf dist out && npx electron-vite
  build && ... electron-builder --win --publish always` — build is no longer
  a separate implied step, it's part of the one command, with a clean of
  `dist`/`out` first so a stale directory can never be reused by accident.
- Republishing under the *same* version number (1.5.30 again, fixed) does
  nothing for a machine that already auto-updated to the bad 1.5.30 —
  electron-updater only offers an update on a version increase. Had to bump
  to 1.5.31 to actually get the fix out. Any bad release must be corrected
  by bumping forward, never by overwriting the same tag's assets.

## 2026-08-03 — Drop the manual reinstall-after-release step (but publishing is still required)

**No more local reinstall after a release — but the build still has to be
*published* to GitHub, which pushing a commit alone does not do.**
- The 2026-06-26 "reinstall after every release" rule predates real auto-update
  (added 2026-07-04). Since then the packaged app already checks for and
  installs updates on every launch — a manual reinstall duplicates that.
- Alternatives: keep reinstalling anyway as an extra regression check. Rejected
  by Aidin (2026-08-03) — the auto-update path is the one users actually go
  through, so it's the one worth trusting; a separate manual step doesn't catch
  anything auto-update wouldn't also catch on the next launch.
- Caught immediately after landing this: releases 1.5.25 and 1.5.26 were built
  with plain `npm run package` (no `--publish`) and committed/pushed, but never
  uploaded to GitHub — `gh release list` still showed 1.5.24 as latest, so
  Aidin's installed 1.5.25 correctly saw nothing to update to. There is no CI
  wired up; a git push by itself never reaches GitHub Releases.
- Fixed by actually publishing: `GH_TOKEN=$(gh auth token) npx electron-builder
  --win --publish always` (see the 2026-07-04 "Release-naming gotcha" entry
  below for why it must be this exact command, not `npm run package` or a
  manual `gh release create`).
- CLAUDE.md's release section now spells out the publish command explicitly,
  not just "push and let auto-update do the rest".

## 2026-08-03 — A board write retries a locked file, and a reload never overwrites an unsaved change

Helm's Jot bridge test went flaky under its parallel test runner, failing with `EPERM ... rename 'todos.json.tmp' -> 'todos.json'`.
Chasing it surfaced two separate ways a board write was silently lost, both in the write path every real mutation goes through - not just in the test.

**1. The rename had no retry.**
`LocalJsonStorage.save` wrote a temp file and renamed it over `todos.json`.
On Windows that rename fails whenever another process holds the target - Dropbox syncing it (Jot's data dir normally IS in Dropbox), an antivirus scanner, a search indexer - and the error propagated as a lost write.

**Decided.** A shared `writeFileAtomic(filePath, contents)` in `storage.ts` with a bounded retry: 4 attempts, 60/120/180ms backoff.
Alternatives rejected: a lock file (a crash leaves it behind and wedges the app), and an unbounded retry (a real permission problem would hang instead of reporting).
Two details are load-bearing.
The temp file gets a random suffix per attempt, so two writers never fight over one fixed `todos.json.tmp`, and it is deleted when an attempt fails so a crashed write leaves no litter.
An `EPERM` is only retried when the target file actually exists: Windows reports both "someone holds this file" and "you may not write in this folder" as `EPERM`, and retrying the second just delays a wrong answer.
`store.ts`'s archive write had the same bare rename and now uses the same helper.
This mirrors the fix Helm already made on its own side (`src/lib/atomicWrite.js`, 2026-07-27) - the same discipline, in the module that backs every board write.

**2. A reload could revert an unsaved change - the actual root cause of the flake.**
`TodoStore.reloadFromDisk` replaced in-memory state with whatever was on disk, with no regard for a save still in flight.
The file watcher fires on our OWN writes too, so any save slow enough to still be running 150ms later - a lock retry, a Dropbox-synced folder, a loaded machine - meant the reload read a one-revision-old file and reverted the change the user had just made.
In the test this showed up as a status move that simply did not happen; in the app it would be a card that snaps back.

**Decided.** Reloads are gated on in-flight writes, in both directions.
A reload arriving while a save is pending is deferred, and `persist()` re-runs it once the file and memory agree (so a genuine external change is never dropped, just delayed).
A reload that STARTS clean but has a save begin while it is reading the file throws its snapshot away and reads again, detected with a per-save counter compared across the read.
Alternative rejected: merging disk and memory per-todo.
That needs per-field revisions to be correct and would turn a data layer that is deliberately "last writer wins on a whole file" into a CRDT - a much larger change than the problem justifies.

Guarded by `scripts/test-write-lock-race.mjs`, which reproduces both failures deterministically: it holds a real handle on the target to force the lock, and drives a storage adapter with a slow `save()` whose watch fires mid-write.
Verified against the pre-fix code (the add is lost outright) and by running Helm's parallel suite 8 times with no failure, where it previously failed roughly every other run.

## 2026-08-02 — A tag can mark the whole row, and it is a tag property

Aidin, while reviewing Helm's auto-captain: "undrar om vi borde ha en ram eller något runt hela kortet för att tydligare markera när ett kort är auto också".
Helm writes tags onto this board - one meaning "a machine is spending money and touching a repo for this card right now", another meaning "this card is waiting on you".
A chip is easy to miss when scanning a full board, and those two are the ones you must not miss.

**Decided.** An optional `emphasis: 'stripe' | null` on the TAG. A todo carrying an emphasised tag gets a bar down its edge in that tag's colour, in both the list and the board.

The important part is where the flag lives.
The obvious implementation is `if (tag.name === 'auto-running')` in the card renderer, and that would be wrong: Jot is a general todo app, public and MIT-licensed, and hardcoding a private orchestrator's vocabulary into it means every new Helm tag needs a Jot release, while anyone else who clones Jot inherits a card style for a feature they do not have.
As a property of the tag, any future tag gets the same treatment with no code change, and the person owns the choice through the tag manager.

Three details that are not arbitrary:

- **One winner, picked by the BOARD's tag order, not the todo's.** A todo's tag array is insertion order, so the same pair of tags applied in a different sequence would otherwise stripe two cards differently and the colour would stop meaning anything.
- **An inset box-shadow, not a border and not a pseudo-element.** A border shifts the text by a pixel as the stripe appears and gets overridden by the card's own hover border; `::before`/`::after` are already taken by the drag-insertion caret.
- **`normalizeTag` had to learn the field.** It strips unknown properties, so a flag written by an external tool would have appeared to work and then silently vanished on the next save. An unrecognised value collapses to `null` rather than reaching the renderer as a class name.

Helm sets it on `auto-running` and `needs-clarification` but deliberately NOT on `auto`: "may be started automatically" is not an active state, and if twenty cards are tagged `auto` the stripe means nothing.

## 2026-07-18 — Todos carry an updatedAt

Added `updatedAt` to the Todo model, set by every CONTENT mutation (status,
priority, deadline, text/description, category, tags, images) but NOT by
reordering (position isn't a content change) - so "last touched" reflects real
edits, not drag-sorts.
Migration: todos written before the field default `updatedAt` to their `createdAt`
(in normalizeTodo), so "updated" is never blank or wrongly "now" on first load.
Shown in the detail panel next to Created, only when it's meaningfully after
creation (>1s), so a just-created todo doesn't show a redundant "Updated".
Note: the "drag-and-drop sorting within a priority" part of the same ask already
existed - the board groups Open into priority bands and, in the default Manual
sort mode, drag reorders within a band (cross-band drops adopt the target's
priority). No change needed there.

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

**Refinement 2026-07-18 (after inspecting Helm + proving core consumption):** the packaging is asymmetric, which is simpler than first planned.
Helm's renderer is plain vanilla JS (no React, no bundler), so the UI is NOT shipped as an importable React component - that would force React into Helm. Instead the UI is shared as Jot's BUILT RENDERER, which a second shell (Helm) embeds in a WebContentsView/`<webview>` with a preload wiring `window.jot` to a core. So only `@jot/core` needs to be a real package; there is no `@jot/ui` component package to build (the fiddliest part, now avoided).
`@jot/core` consumability is proven: compiled standalone (tsc), an external consumer instantiated TodoStore against a todos.json and successfully read another shell's data, mutated, received change events, and persisted back to the shared file.
Open packaging detail: module format. This repo is `type: module` (ESM), so `@jot/core` should ship ESM - which needs a bundled or extension-correct build (the source uses extensionless imports that raw Node ESM won't resolve). Decided at the packaging step.

## 2026-06-22 — Initial architecture

**Stack: Electron + React + TypeScript + Vite (electron-vite).**
- Alternatives: Tauri (lighter, Rust backend), native WinUI, web app + PWA.
- Why: the global hotkey + always-on tray + frameless popover pattern needs a
  desktop runtime with a mature global-shortcut API. Electron is the team's
  proven stack (Loom, Halyard), so velocity wins for v1. Tauri stays a viable
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
  reach. On this developer machine it's set (User-scope env var) to `D:\YourSyncedFolder\jot`,
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

## 2026-06-26 — Reinstall after every release (superseded 2026-08-03)

**Every new Jot release is installed locally before handoff.**
- Alternatives: only publish the GitHub release, or leave local install manual.
- Why: the installed Windows app is the real day-to-day runtime. Reinstalling
  after each release catches packaging and startup regressions immediately and
  keeps the machine in sync with the latest shipped build.
- Superseded once real auto-update shipped (2026-07-04 below) — see the
  2026-08-03 entry.

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
