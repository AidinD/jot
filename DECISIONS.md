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
