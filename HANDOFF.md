# Handoff - latest session state

_Overwritten on each handoff (latest-only); prior handoffs are in git history._
_Saved 2026-08-23, late. For durable rationale see each repo's DECISIONS.md._

This session spanned the whole suite, not just Jot. Everything below is
committed and pushed.

## Where things stand

| Repo | State |
| --- | --- |
| **jot** | 1.5.36, released. Unchanged tonight except a verified-identical icon regeneration. |
| **keel** | Pushed. Now three consumers. Two new distance helpers, one stray declaration removed, plus a test that stops it coming back. |
| **tend** | **0.1.4**, released as 0.1.3 and then bumped for `.gitattributes`. Migrated onto `keel/window` and `keel/icon`. |
| **brief** | **New repo**, `github.com/AidinD/brief`, private, MIT. Built, tested, pushed. **Not released** - see below. |

## What happened

**Tend moved onto keel** - the point of it being second was that it is the
opposite of Jot on every axis: plain DOM, JS with JSDoc, no bundler. Two things
only that case could show. keel has to be a real `dependency` there (the import
survives into the asar, and a preload that cannot resolve it fails *silently* -
the window buttons just stop working), so the packaged E2E now clicks maximise
and asserts the window resized. And the renderer's type for the bridge is read
back off keel's own declaration rather than restated.

The three window handlers also left Tend's `OPERATIONS` whitelist, where they
were a category error, and stopped using `getFocusedWindow()`.

Tend's icon is the one migration that is **not** byte-identical: its generator
supersampled 4x4 per pixel where keel computes coverage analytically. Measured,
not assumed - 1.5% of pixels moved, all on an outline, none inside a flat area.

**keel** picked up `distSegmentAt` (distance plus position along the segment, for
tapered strokes) and `distRoundedRect` (signed, because a plate is filled rather
than stroked). It also still had a hand-written `src/index.d.mts` from the
reversed decision two commits earlier - the drift test could not see it, because
that test compares `types/` against a fresh generation. There is now a test that
`src/` holds no declarations at all.

**Brief was built** - the news/secretary app. Three sections once a morning: the
world, your week, and the few things to confirm. Plain DOM like Tend, keel for
the title bar and the icon, 29 unit tests and 13 app checks, green in
development and in the packaged build.

## The one thing worth reading before touching Brief

The privacy line had to be redesigned mid-build, and the reasoning is in
`brief/DECISIONS.md` under "Derived locally, sent only on purpose".

Relevance is derived from the Jot board rather than configured - the right idea,
and it was nearly a leak. The first dry run had 51 items headed for Google:
four internal project codenames from the work side, and from the private side
what someone is reading and where they have applied. **What Brief knows and what
Brief may send are now different facts.** `outbound.json` is opt-in per item,
defaults to nothing, and refuses rather than falling back. Filtering by Jot's
`work`/`private` domain was considered and is worse - the work half is exactly
where the codenames are.

## Next, in order

1. **Look at Brief.** `cd ../brief && npm run sample && npm run dev`. It is
   deliberately unreleased - a brand new app should be seen before it installs
   itself. A local installer is already built in `brief/dist/`.
2. **Helm to public** - step 1 of 3 done (the fork is deleted). Remaining: the
   line-by-line review of helm's ~3500-line DECISIONS.md, which Aidin asked to
   do together, then flip it public. That also restores its auto-update.
3. **Brief's generator.** The app renders; nothing writes yet except the sample
   script. Tracked on the board as a subtask of the Brief ticket.
4. Still open from the suite epic: keel's storage adapter, release script and
   header CSS. Nib and Loom still carry their own icon copies.

## Board

Categories used tonight: **Idéer** (the suite epic `5359ac28`, now in-progress
with three subtasks; the Brief ticket `c3d3c102`, now in review) and **Tend**.
Nothing was moved to `done` - that stays Aidin's call.
