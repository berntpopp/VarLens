# Shortlist flicker on case open / case switch — before

**Date:** 2026-10-06 · **Target:** the user's running dev server `http://localhost:8787/` (v0.73.0, web mode, 75 ms API latency), browsed read-only with headless Playwright (no restart, no writes). Login: dev admin.
**Harness:** `shortlist-switch.cjs` (rAF DOM sampler on `.shortlist-panel__body` + buffered `layout-shift` observer with sources + `/api` request log) and `shortlist-film.cjs` (CDP screencast). Cases: LB26-0407 → LB26-0395 → LB25-6366 → LB26-0407.

## Numbers

| Step | Viewport / CPU | CLS (no input) | all shifts | shortlist hidden (frames) | rows → blank | API requests |
|---|---|---:|---:|---|---:|---:|
| open LB26-0407 | 412×823, 4× | **0.113** | 0.118 | panel absent until 761 ms, then empty body 57 ms, then skeleton | 0 | 5 |
| switch → LB26-0395 | 412×823, 4× | 0.0001 | 0.0001 | **hidden 327 ms (693–1020 ms)**, SNV/Indel tab shown instead | 0 | 7 |
| switch → LB25-6366 | 412×823, 4× | 0.0002 | 0.0002 | **hidden 239 ms** | 0 | 5 |
| switch → LB26-0407 | 412×823, 4× | 0.0000 | 0.0001 | **hidden 149 ms** | 0 | 4 |
| open | 1440×900, 1× | 0.0000 | 0.0015 | absent until 200 ms, empty body 31 ms | 0 | 5 |
| switch ×2 | 1440×900, 1× | 0.0000 | ≤0.0001 | hidden 110–160 ms | 0 | 5–7 |

`rows → blank` stays 0 only because the body is never emptied while visible — the whole Shortlist region is swapped out instead (`bodyH=0`), which the user sees as the flicker.

Filmstrips (mobile, 4× CPU): `shortlist-before-switch-filmstrip.jpg`, `shortlist-before-open-filmstrip.jpg`. The switch strip shows, in order: Shortlist (old case) → **SNV/Indel tab with filter toolbar, preset chips and an empty "0-0 of 0" skeleton table** (876 ms) → Shortlist again with the *previous case's* rows dimmed (978–1195 ms) → new rows (1407 ms).

Request log per switch: `variants/typeCounts`, `caseMetadata/getFullMetadata`, `variants/query` (hidden SNV table), `variants/shortlist`, plus `variants/getFilterOptions`, `analysisGroups/list`, `tags/list` on the first switch — the FilterToolbar mounts because the SNV tab was briefly active.

## Root causes (systematic-debugging)

1. **Tab reset on case switch.** `CaseView.vue`'s `selectedCaseId` watcher sets `selectedVariantType = 'snv'` as a "not chosen yet" sentinel and only moves back to `'shortlist'` after `variants/typeCounts` resolves. For that round trip the Shortlist region is `v-show`-hidden and the per-type region (SNV table, filter toolbar, preset chips) is shown: Shortlist → SNV → Shortlist on every switch, and on open the shortlist appears only after the counts. Side effect: `firstActivated` flips (typeCounts of the previous case are still loaded), mounting the FilterToolbar and firing its option IPC calls.
2. **Header growth on first result (open-case CLS 0.113 mobile).** The shortlist header renders the "Scored (capped) …" summary only once a result exists; on narrow screens it wraps the header taller and pushes the table body down 8 px (`shortlist-panel__body y198→206`). Already fixed on this branch (commit e850e195: summary always rendered, single line).
3. **Empty body before the skeleton.** `showSkeleton = loading && result === null` is false for the first frame(s) because the query starts asynchronously, so the body is empty for 31–57 ms before the skeleton appears.
4. **Previous case's rows shown as the new case's shortlist.** On switch the old result stays on screen undimmed until the 150 ms stale delay elapses, then dimmed until the new rows arrive (up to ~500 ms at 4× CPU), under the new case's header.

Not causes: no remount via `:key`/`v-if` (the panel stays mounted), no multi-pass scoring (one `variants/shortlist` call), row heights are stable (shifts on row content change are ≤0.0002).
