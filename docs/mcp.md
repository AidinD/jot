# The MCP server

Jot's board is a JSON file, and `INTEGRATION.md` describes how to edit it
directly. This is the other way in: a standalone Node process that exposes the
board as MCP tools, reading and writing the same `todos.json` the app uses, so it
works with the app closed.

It is not a nicer front door for the same thing. It exists because of a guard.

## Why a server and not a file path

Some agent seats are denied every file-writing tool at the hook level and exempt
MCP tools. The alternative - a guard that allows writes inside one folder - was
considered and rejected, for one reason:

> A path-based guard allows ANY write inside an allowed folder, including an
> invalid one. An MCP surface can refuse an invalid write.

That refusal is the feature. An invalid write to this board does not fail loudly:

- a task filed under a `categoryId` that does not exist is in the file and in no
  view of the app,
- a `status` the app does not know collapses to `open` the next time the file
  loads, quietly undoing the move somebody asked for,
- a subtask hung under another subtask is written and then never rendered, since
  every view nests one level deep.

None of those is a crash. That is what makes them expensive.

## Wiring it up

```json
{
  "mcpServers": {
    "jot": {
      "command": "node",
      "args": ["<path to this repo>/src/mcp/server.js"],
      "env": { "JOT_DATA_DIR": "<the data directory the app uses>" }
    }
  }
}
```

`JOT_DATA_DIR` is optional and is resolved exactly as the app resolves it: when
unset, the server computes the same per-user location Electron gives the app
(`%APPDATA%/jot` on Windows), so both find the same folder either way. It prints
the file it settled on to stderr at startup, because the commonest way this goes
wrong is silent - the server and the app each read a real board, in different
places, and both look correct.

Diagnostics go to stderr. Anything on stdout is protocol.

## Reading

| Tool | Answers |
| --- | --- |
| `jot_categories` | The lists, with per-status counts, work/private domain and bound repo folder |
| `jot_todos` | Tasks, filtered by list, status or parent, in the app's own order |
| `jot_todo` | One task in full, with its description and subtasks |

Reads answer a question rather than dumping the file. Tasks come back with their
list name and tag names resolved, their subtasks counted, and sorted the way the
app sorts them: priority ascending, and within one priority the manual drag
order. An agent that re-derives that from raw rows gets a different answer from
the one on screen, and then the two disagree about what the board says.

Two things that are easy to get wrong and are therefore decided here:

- **Lower priority is more urgent, and `0` means "no priority" - not "least
  urgent".** It is zero on a number line: `-1` sits above it and `1` below.
- **Root tasks only, unless asked.** A listing that mixes parents and subtasks is
  how the same work gets counted twice.

Descriptions are deliberately absent from listings. They hold long free-text
notes - the reason a task was parked, a whole plan - so every listing would
otherwise carry most of the file. `jot_todo` gives one task in full.

## Writing

| Tool | Does |
| --- | --- |
| `jot_add_todo` | Adds a task at the top of a list, `open`, as quick capture does |
| `jot_add_subtask` | Hangs a subtask under a root task, inheriting its list |
| `jot_set_status` | Moves a task between open, in-progress, review and done |
| `jot_set_description` | Replaces a task's description |
| `jot_set_priority` | Sets a task's priority |

A task created here is written with all fifteen fields the app writes, in the
same order, so it is indistinguishable from one typed into the app. Finishing a
task stamps `completedAt` and unpins it, exactly as the app does.

### What is deliberately not here

**Nothing deletes.** No tool removes a task, a list or a tag. Removing a list
also deletes every task on it and nothing in the file survives it. An agent that
reads a board wrong should cost a wrong card, not a lost list.

**Nothing pins.** `pinned` makes an always-on-top panel appear on the user's
desktop. That is a claim on their attention right now, made by something they are
not looking at.

**Nothing sets tags.** Reads report tag names, so a tag-based convention stays
legible; writing one is a judgement about scope rather than a fact about a task.

## Every write can be refused

| Refused | Because |
| --- | --- |
| A `categoryId` that is no list | The card would exist and appear nowhere |
| A `status` outside the four | It collapses to `open` on next load, undoing the move |
| Empty or missing `text` | A card nobody can identify |
| A `parentId` that is no task | Nothing to hang it under |
| A `parentId` that is itself a subtask | Jot nests one level; a deeper one is never shown |
| A priority that is not a whole number | `2.5` is silently truncated to `2` |
| An id that is on no task | The commonest shape of a stale id |
| A deadline that reads as seconds | It would land in 1970, permanently overdue |
| A board that is not valid JSON | A write now replaces a recoverable file with an empty one |

Every message names what was wrong AND what would have been right - the lists
that do exist, the statuses there are. A caller that gets that corrects itself; a
caller that gets "invalid argument" asks the user.

Refusals come back as data, never as a thrown exception, and they are reported
both as an MCP error and in the content, so a client that surfaces only one of the
two still shows the reason.

## Two writers, one file

Both the app and this server rewrite the whole document, and neither takes a
lock. A naive write silently reverts whatever the other just did, and a lost
write is worse than a refused one because nobody knows to redo it.

So every write is: read, validate against that read, then re-check the file's
content hash immediately before the atomic rename. If the board moved in that
window the mutation is re-read and re-applied rather than forced through; only a
board that keeps moving is refused. A **content hash**, not size and mtime,
because the common shape of a real concurrent edit is byte-identical in length -
a drag-reorder is a pure array permutation, and `open` -> `done` is the same
number of characters.

The rename itself retries while the file is locked, which is shared with the
app's own writer in `keel/storage`: the data directory is normally a synced
folder, and the sync client holding the file mid-rename is the normal operating
condition rather than an edge case.

## Checking it works

```bash
npm run test:mcp        # the whole surface, without a process
npm run test:mcp:e2e    # the real server as a child process, over stdio
```

The first drives every tool against a scratch board and checks each refusal
twice: that the caller is told what was wrong, and that the file on disk is
byte-identical afterwards. "Returned an error" and "changed nothing" are
different facts, and only the pair is worth anything.

The second starts `src/mcp/server.js` for real and drives it with an MCP client,
because a typo in the wiring or a diagnostic written to stdout would otherwise
ship green and reach a client as "server disconnected" with nothing to go on.
