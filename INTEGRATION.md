# Jot External Integration

Jot keeps its canonical app state in a local JSON file and watches that file
for external edits. That means external agents do not need MCP support to read
or write data.

**There is also an MCP server** over the same file - `docs/mcp.md`. Prefer it
when the writer is an agent: every write it accepts is validated first, and the
ones described further down this page as things you must get right (a real
`categoryId`, a status from the known set, valid JSON, an atomic write) are
refused with a message instead of landing in the file. This page stays the
contract for a tool that cannot speak MCP, and for understanding what the file
actually holds.

## Data location

The file lives under Electron's `userData` folder:

`<userData>/todos.json`

On Windows the default resolves to (note the lowercase `jot`, from the app
`name`):

`C:\Users\<you>\AppData\Roaming\jot\todos.json`

Image attachments live alongside it under `jot-images/<todoId>/`.

### Relocating with `JOT_DATA_DIR`

Set the `JOT_DATA_DIR` environment variable to store data somewhere other than
the default. Jot then keeps `todos.json` and `jot-images/` under that directory,
and on first launch migrates the existing data over once (never overwriting a
file already there). This is per-machine configuration — nothing is hardcoded in
the app, so distributed copies stay portable.

Two reasons to use it:

- **Cross-device sync** — point it at a synced folder (Dropbox, etc.).
- **External agent access** — some packaged/sandboxed assistants have their
  writes to `%APPDATA%` silently redirected into a private per-package overlay,
  so edits never reach the app's real file. Pointing `JOT_DATA_DIR` at a plain,
  non-virtualized path (e.g. a folder on a data drive) lets both the app and the
  external tool read and write the exact same file.

## Encoding (read this before editing)

The file is **UTF-8 without a BOM**. When you read or write it:

- Read and write as UTF-8 explicitly. In PowerShell, `Get-Content -Encoding UTF8`
  / write with a no-BOM UTF-8 encoder. Reading without specifying UTF-8 makes a
  terminal render `å`/`ä`/`ö` as `Ã¥`/`Ã¤`/`Ã¶` — that is a *display* artifact,
  NOT corruption. Check the raw bytes (`C3 A5` = `å`) before "fixing" anything.
- Do not prepend a BOM and do not double-encode. Jot self-heals legacy
  double-encoded text on load (`repairDoubleEncoding` in `storage.ts`), but don't
  rely on it — write correct UTF-8 in the first place.

## File format

Jot accepts both:

- the current object shape:

```json
{
  "todos": [],
  "categories": []
}
```

- the legacy v0.1 shape, which was just a bare `Todo[]`

## Current schema

### Todo

```ts
{
  id: string
  text: string
  status: "open" | "in-progress" | "review" | "done"
  description: string
  images: string[]
  categoryId: string | null
  tags: string[]        // tag catalogue ids
  priority: number      // lower sorts higher; 0 = none
  deadline: number | null
  pinned: boolean       // mirrored onto Jot's always-on-top desktop panel
  parentId: string | null // set = this todo is a subtask; one level deep only
  createdAt: number
  updatedAt: number
  completedAt: number | null
}
```

Every field is optional on the way *in* — Jot's loader fills defaults for
anything missing (`pinned` defaults to `false`) — but Jot writes all of them
back, so a reader should expect them all to be present.

`pinned` is Jot's "get this done today" shortlist: pinned todos are mirrored
onto a small always-on-top desktop panel, which exists exactly while at least
one todo is pinned. Setting `pinned: true` from outside is enough to make the
panel appear. Jot clears it automatically when a todo becomes `done`.

### Category

```ts
{
  id: string
  name: string
  color: string
  createdAt: number
  repoPath?: string // optional absolute folder path this list is associated with
  domain?: 'work' | 'private' // optional work/private classification for this list
}
```

`repoPath` is optional. When present it is an absolute path to the repo/folder
the list belongs to, letting an external consumer map a working directory to a
list deterministically instead of fuzzy-matching on the list name. Absent (or
empty) means no association.

`domain` is optional. When present it is `'work'` or `'private'`, letting an
external consumer (e.g. Maestro's Focus mode) read a list's classification
directly instead of guessing it from the list name. Absent means no domain is
set for that list.

## Safe write flow

When an external tool edits the file:

1. Read the latest `todos.json`.
2. Modify the JSON in memory.
3. Write to a temp file in the same directory.
4. Rename the temp file over `todos.json`.

That keeps writes atomic and avoids partial JSON if the process is interrupted.

## Referring to one card

Right-clicking a card in Jot copies a reference to it:

```
jot:7e2c1f80-2f3b-4a51-9a1f-2b3c4d5e6f70 "Ship the release"
```

The uuid is the todo's `id` in this file — look it up directly, and ignore the
quoted text, which is a copy of `text` at the moment it was copied and is there
so the person pasting can see they grabbed the right card. Subtasks have ids of
their own and are referenced the same way.

Nib uses the same shape for notes (`nib:<noteId> "Title"`), so a reference that
arrives in a conversation says which app it belongs to.

## What Jot does on external changes

Jot debounces filesystem events, reloads the JSON file, and refreshes the UI if
the file contents actually changed.

## Notes

- Keep the JSON valid.
- Preserve object fields you do not understand.
- Treat Jot as the source of truth if it is open and the file is edited by
  something else.
