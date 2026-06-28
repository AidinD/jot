# Decisions

Key decisions for Jot and the reasoning behind them. See git history and the
transcript for the step-by-step; this file is only the choices worth revisiting.

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
