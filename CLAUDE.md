# mizraj — notes for Claude

## Shell views & navigation

The left rail and the ⌘1..N chords both derive from one registry,
`src/app/shellViews.tsx` (so rail order and chord index can never drift).
Screens are mapped path→component in `src/app/MainContent.tsx`; routes live in
`src/app/router.tsx`.

## Parked features — NOT dead code

**Board** (`pipeline`) and **Plans** are intentionally hidden from the rail and
the ⌘ chords. Their entries were removed from `shellViews.tsx`, nothing else.
Both remain fully wired and shippable — do not delete their modules or routes:

| Feature | Module                   | Route(s)                                                                 | Still reachable via   |
| ------- | ------------------------ | ------------------------------------------------------------------------ | --------------------- |
| Board   | `src/features/pipeline/` | `/pipeline` (MainContent ROUTES)                                         | URL                   |
| Plans   | `src/features/plans/`    | `/plans`, `/plans/:kind/:slug` (Plans is MainContent's `FALLBACK_ROUTE`) | URL + command palette |

`features/review/reviewFiles.ts` is shared by pipeline, diff, projects and
missionControl — another reason not to treat these as removable.

**Re-enabling:** the full copy-paste recipe (imports + the two entry objects +
the original ⌘3/⌘4/⌘5 chord order) lives in the `TODO(parked-views)` block at
the top of `shellViews.tsx`. Search `parked-views` across the repo for the test
assertions that were dropped (`Rail.test.tsx`, `useShellShortcuts.test.tsx`).
