# Backlog

Deferred ideas, not scheduled. See DECISIONS.md for decisions already made.

## Cross-device sync via Google Tasks (deferred 2026-06-22)

Decided approach, parked until the need actually grows:

- **Opt-in.** Default app stays purely local (today's behavior); nothing leaves
  the machine until the user connects. A "Connect Google Tasks…" action (tray /
  settings) starts it; disconnect stops sync and keeps all local todos.
- **Local stays primary.** Local JSON remains the source of truth so
  quick-capture works instantly/offline. A SyncEngine layers two-way
  reconciliation on top (poll ~30–60s + on local change; Google Tasks has no
  push for personal use).
- **Mobile = the Google Tasks app**, not a Jot app. That is the whole reason
  this is the easy path — no mobile client to build.
- **Auth:** OAuth 2.0 loopback flow in Electron; refresh token stored encrypted
  via `safeStorage`. Requires the user to create a Google Cloud project +
  OAuth Desktop client + enable Tasks API.
- **Conflict:** last-write-wins on `updated` timestamp for v1.

### Open knot: category translation/mapping
Jot category ↔ Google Tasks list is not a clean 1:1:
- Name matching (case, duplicates, renames on either side).
- Lists/categories that exist on only one side — create, ignore, or merge?
- Jot's color and explicit ordering have no Google Tasks equivalent (keep local).
- A stable mapping table (jot id ↔ google id) is needed so renames don't
  duplicate.

## Auto-update via GitHub
Like Loom — needs `latest.yml` + an electron-builder publish config and a
release-upload step. Optional.
