# Jot

A keyboard-first quick-capture todo app for Windows. Press **`Ctrl+Alt+.`** from
anywhere — whatever app you're in — type a todo, hit **Enter**, and it lands on
top of your list. The popover dismisses and focus returns to where you were.

## Features

- Global quick-capture popover (`Ctrl+Alt+.`), works regardless of focused app
- Lives in the system tray; click the tray icon to open the full list
- Frameless window — the header row is the title bar (drag handle + window buttons)
- Pin todos to a small always-on-top desktop panel: your "get this done today" shortlist
- Add / complete / delete todos, newest on top
- Completed items collapse into a "Completed" section with one-click clear
- Local-first storage (`todos.json` in the app's userData folder)
- Right-click any card for its reference (`jot:<id> "text"`), to paste into a conversation
- External agent integration via watched JSON file; see `INTEGRATION.md`
- Storage seam ready for a future cloud-sync adapter (Cloudflare Workers + D1)

## Develop

Jot depends on [**keel**](https://github.com/AidinD/keel), the shared layer under
the suite, linked from the filesystem — so it has to be checked out **next to**
this repo before `npm install` will work:

```
Tools/
├── jot/
└── keel/
```

```bash
git clone https://github.com/AidinD/keel ../keel
npm install
npm run dev
```

Without the sibling checkout `npm install` still **exits 0** — npm links
`file:../keel` to a dangling symlink and says nothing at all. What fails is the
first import: `npm run icon` and `npm run release` die with
`ERR_MODULE_NOT_FOUND`, and the build cannot resolve `keel/storage`. keel stays a
devDependency because electron-vite inlines it into the bundle rather than
resolving it at runtime.

The dev build mounts the tray and registers the global shortcut. Close the
window and the app keeps running in the tray — quit from the tray menu.

## Build a Windows installer

```bash
npm run package
```

Produces an NSIS installer under `dist/`.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/main/index.ts` | App lifecycle, tray, global shortcut, IPC wiring |
| `src/main/store.ts` | In-memory todo store, persistence, change broadcast |
| `src/main/storage.ts` | `StorageAdapter` interface + local JSON impl (sync seam) |
| `src/main/windows.ts` | Main window + capture popover creation/positioning |
| `src/preload/index.ts` | `window.jot` / `window.capture` IPC bridge |
| `src/renderer/src/main/` | Main list UI (React) |
| `src/renderer/src/capture/` | Quick-capture popover UI (React) |
| `src/renderer/src/pinboard/` | Pinned-todos desktop panel UI (React) |
| `src/renderer/src/shared/` | Pieces used by more than one of those (card menu, tags, dates) |

See [DECISIONS.md](DECISIONS.md) for the architecture rationale.
