# Jot External Integration

Jot keeps its canonical app state in a local JSON file and watches that file
for external edits. That means external agents do not need MCP support to read
or write data.

## Data location

The file lives under Electron's `userData` folder:

`<userData>/todos.json`

On Windows this resolves to (note the lowercase `jot`, from the app `name`):

`C:\Users\<you>\AppData\Roaming\jot\todos.json`

This is a plain, real filesystem path — verified reachable by external agent
file tools and ordinary shell processes alike (no sandbox redirection). Image
attachments live alongside it under `jot-images/<todoId>/`.

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
  status: "open" | "in-progress" | "done"
  description: string
  images: string[]
  categoryId: string | null
  createdAt: number
  completedAt: number | null
}
```

### Category

```ts
{
  id: string
  name: string
  color: string
  createdAt: number
}
```

## Safe write flow

When an external tool edits the file:

1. Read the latest `todos.json`.
2. Modify the JSON in memory.
3. Write to a temp file in the same directory.
4. Rename the temp file over `todos.json`.

That keeps writes atomic and avoids partial JSON if the process is interrupted.

## What Jot does on external changes

Jot debounces filesystem events, reloads the JSON file, and refreshes the UI if
the file contents actually changed.

## Notes

- Keep the JSON valid.
- Preserve object fields you do not understand.
- Treat Jot as the source of truth if it is open and the file is edited by
  something else.
