# Jot External Integration

Jot keeps its canonical app state in a local JSON file and watches that file
for external edits. That means external agents do not need MCP support to read
or write data.

## Data location

The file lives under Electron's `userData` folder:

`<userData>/todos.json`

On a normal Windows install this is usually under your roaming app data
folder, but the exact path can vary with the app name and packaging setup.

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
