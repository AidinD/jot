# Shareable Jot + team sync - exploration

Status: EXPLORATION for review (no code). Jot task 2fae998c ("Kan vi göra jot delbar och synka för teams?").
Written 2026-07-18 while the core/UI split (DECISIONS 2026-07-18) landed - which is what makes most of this cheap.

## The question, unpacked

"Shareable + team sync" is really a ladder, not one thing. Each rung is a different amount of work and a different product:

1. Read-only share - someone sees a list (or the board) but can't edit. Useful for "here's my plan".
2. Multi-device sync for ONE person - the same board on desktop + mobile + Helm, one owner. (This is the parked task 36c8caf0.)
3. Shared editing of a list - two people both edit the same list; last-write-or-merge, needs identity + a conflict story.
4. Real team workspace - lists owned by a team, per-list membership/permissions, presence, real-time.

The honest first question for Aidin: which rung is the actual want? Jot was built as a fast personal capture tool; rungs 3-4 change what it IS. This doc assumes the answer is somewhere around 2-3 (personal multi-device + light sharing), and flags where rung 4 diverges.

## What the current architecture already gives us (the cheap part)

The core/UI split just made this tractable:

- **The storage seam already exists.** `@jot/core`'s `StorageAdapter` interface (`load` / `save` / `watch`) is the ONE place persistence lives - the store and UI never touch files directly. DECISIONS (2026-06-22) already anticipated this: "a future Cloudflare-backed adapter (Workers + D1) can be dropped in without touching the app." So sync is fundamentally "write a second StorageAdapter", not a rewrite.
- **The host/client model generalizes.** The split's host/client mode (one runtime writer owns the data, others connect) is already a mini sync protocol over a local socket. A remote backend is the same shape with the socket replaced by the network - the core doesn't care whether its host is local or a Worker.
- **Change events + file-watch exist.** The store already emits changes and reloads on external edits, so a sync layer that writes the file (or pushes events) lights up every mount for free.

So the expensive parts are NOT in Jot's core - they're the backend, identity, and the conflict/permission model.

## Options

### A) Dropbox-file sync (what Aidin does solo today)

`JOT_DATA_DIR` -> a Dropbox folder; every device reads/writes the same `todos.json`.
- Pros: zero backend, works now, already how he runs it.
- Cons: NOT real team sync - Dropbox does whole-file last-write-wins, so two people editing at once silently clobber each other (the same multi-writer race the host/client mode solves locally, but across machines Dropbox can't arbitrate). No identity, no per-list permission, mobile is awkward (Dropbox file access on phones is clunky). Fine for rung 1-2 solo; breaks at rung 3.

### B) A cloud backend as a StorageAdapter (Cloudflare Workers + D1, real-time via Durable Objects)

Implement `RemoteStorageAdapter` in `@jot/core` that talks to a Worker; the Worker owns the data in D1, a Durable Object per workspace fans out real-time changes.
- Pros: the RIGHT shape for rungs 3-4 - real identity, per-list membership/permissions, server-arbitrated writes (no clobber), real-time presence. Drops into the existing `StorageAdapter` seam. Plays to Aidin's existing Cloudflare stack (Reinmaker analytics, beatdrop already run Workers+D1+DO). Mobile becomes a thin web client hitting the same Worker.
- Cons: the real work - auth (who are you), a sharing/permission model, a migration from the local JSON, and running a service (uptime, backups). This is a genuine product surface, not a weekend.
- Phasing that de-risks it: (1) a personal cloud adapter first - same single user, data in D1 instead of a file, proves the adapter + sync end-to-end and gives rung-2 multi-device sync; (2) then add sharing/permissions for rung 3; (3) real-time/presence for rung 4.

### C) Integrate an existing service (Google Tasks / Todoist)

Sync Jot's todos to a third-party task service that already solves sharing + mobile.
- Pros: offloads the backend, identity, mobile apps, and sharing entirely.
- Cons: Jot's model (statuses as kanban columns, per-list categories, tags, priority bands, images, subtasks) is richer than these services' models - the mapping is lossy, and you inherit their UX/limits. It stops being "Jot synced" and becomes "Jot as a front-end to Todoist". Good only if the real want is "my Jot tasks also show up in a tool my team already uses", not "Jot itself becomes multi-user".

## Recommendation

- If the want is **personal multi-device** (rung 2): the cleanest proper path is **B phase 1** (a personal cloud adapter) - it also happens to be the foundation for everything above it, and it retires the fragile Dropbox-file approach. Dropbox-file (A) stays fine as the no-backend stopgap until then.
- If the want is a **real team workspace** (rung 4): it's **B, fully** - and worth being honest that it's a real project (auth + permissions + a service), effectively "Jot the product" rather than a feature. Worth a go/no-go on whether Jot should become that.
- **C** only if the goal is interop with a tool the team already lives in, accepting a lossy model.

The split we just did is what makes B cheap on the *client* side (it's one more `StorageAdapter`); the cost is the backend and the product decisions, not Jot's code.

## Refinement 2026-07-18 (Aidin's steer): provider-agnostic, not Jot-as-backend

Aidin's real driver: for Helm to work on multi-user PROJECTS, tasks must be assignable + synced, like Jira - and ideally users aren't locked to Jot; they could link to Jira etc.

The sharper direction this points to - and the recommendation:

- **Do NOT make Jot itself a multi-user backend.** Assign + sync + permissions + presence = rebuilding Jira. Aidin already has Jira in the ecosystem (the Atlassian MCP, Crewline). For a team project, let Jira be the source of truth - assignment + sync come for free from it.
- **Agnostic BY INTERFACE, at the Helm/auto-captain layer (NOT inside @jot/core).** Define a lean `TaskProvider` interface: list tasks, a mapped lifecycle status, assignee, project, and update status/assignment. `JotProvider` = the personal host store (exists). `JiraProvider` = via the Atlassian MCP. The auto-captain works against the interface, so it picks up + dispatches tasks regardless of source. Jot stays the personal fast-capture tool; team projects run off Jira.
- **The trap to avoid:** a universal all-providers mapper. Jot's model (kanban statuses, categories, tags, priority bands, subtasks) and Jira's (issues, sprints, epics, workflows) differ enough that a generic "sync everything" layer becomes either lowest-common-denominator (loses both) or an endless maintenance burden of lossy per-provider mappings. Keep the interface deliberately MINIMAL, and build ONLY the providers actually used (Jot + Jira first) - not a mapper for all of them. That's what keeps it "not too big".

This is smaller than making Jot multi-user, and it separates cleanly: Jot = personal + simple; the agnostic task layer = Helm's orchestration; the team backend = Jira (or whatever the team already uses).

Still open: how far to go now (a Jira-read + auto-dispatch slice is a small, high-value first cut), and whether personal multi-device (a Cloudflare adapter) is wanted in parallel or later.

## Open questions for Aidin

- Which rung is the real want - your own multi-device, or actually letting other people into your lists?
- If team: whose team (The Gang?), and does it need permissions or is "everyone with the link can edit" enough?
- Is mobile part of this want, or separate (task 36c8caf0)? A cloud backend (B) solves both at once - a thin mobile web client on the same Worker - which is an argument for doing B over patching Dropbox-file sync.
