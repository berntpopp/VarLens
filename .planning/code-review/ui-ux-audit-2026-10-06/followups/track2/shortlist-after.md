# Shortlist flicker on case open / case switch — after

Before: `shortlist-before.md` (measured on the user's dev server :8787). After: this branch (`perf/mobile-table-render`) built with `VARLENS_WEB_BASE=/ npm run build:web` and served on :8820 (schema `web_dev_track2`, a copy of the dev data: LB26-0060 / LB25-6119 / LB25-4024, 75 ms API latency). Same harness (`shortlist-switch.cjs`, `shortlist-film.cjs`).

| Step | Viewport / CPU | CLS before → after | all shifts (incl. input window) before → after | Shortlist hidden before → after | API requests before → after |
|---|---|---|---|---|---|
| open case | 412×823, 4× | **0.113 → 0** | 0.118 → 0 | panel appears after type counts → shown immediately (skeleton from first frame) | 5 → 5 |
| switch 1 | 412×823, 4× | 0.0001 → 0 | 0.0001 → 0.0002 | **327 ms → 0** | 7 → 3 |
| switch 2 | 412×823, 4× | 0.0002 → 0 | 0.0002 → 0 | **239 ms → 0** | 5 → 3 |
| switch 3 | 412×823, 4× | 0 → 0 | 0.0001 → 0.0002 | **149 ms → 0** | 4 → 2 |
| open / switches | 1440×900, 1× | 0 → 0 | ≤0.0015 → ≤0.0015 | 110–200 ms → 0 | 5–7 → 2–5 |

Rows → empty/skeleton → rows on a switch: 0 (before and after). On open, the empty body frame before the skeleton (31–57 ms) is gone.

Filmstrips (mobile, 4× CPU): `shortlist-after-switch-filmstrip.jpg` / `shortlist-after-open-filmstrip.jpg` vs the `shortlist-before-*` strips. The SNV/Indel tab, filter toolbar, preset chips and the "0-0 of 0" skeleton table no longer flash between two Shortlist frames.

## Fixes

1. `views/CaseView.vue` — the case watcher lands on the preferred default tab (`settingsStore.defaultCaseTab`) immediately instead of the `'snv'` sentinel; `loadTypeCounts` only corrects it (empty case → `'snv'`, `'snv'` preference → first present type) and only if the user has not picked a tab since the switch (`autoSelectedTab`). Side effects removed: FilterToolbar no longer mounts on a switch (`getFilterOptions`, `analysisGroups/list`, `tags/list` gone), and the hidden SNV table no longer refetches.
2. `views/CaseView.vue` — while the first type counts load, a 36 px placeholder reserves the tab row (it pushed the banner and shortlist down when it appeared).
3. `components/case/ProbandContextBanner.vue` — the banner stays on one line (details `text-no-wrap`, "No clinical phenotypes recorded" truncates), so its height no longer differs between cases on narrow screens.
4. `components/shortlist/ShortlistPanel.vue` — skeleton from the first frame until the first result (was gated on `loading`, which starts a tick later); the summary line is always rendered on one line (header height fixed, from commit e850e195).
5. `components/shortlist/ShortlistTable.vue` — rows keyed per result set (`useResultSetKeys`) so a new case's rows are fresh elements instead of moved ones.

Kept as is (stale-while-revalidate, same as VariantTable refetches): on a switch the previous case's rows stay on screen until the new shortlist arrives (≈250 ms at 4× CPU), dimmed by `useTableLoadingState` after 150 ms, with `aria-busy`.

## Regression checks

- `tests/renderer/views/CaseView.test.ts`: "keeps the Shortlist tab active throughout a case switch (no SNV flash)" records every `selectedVariantType` value synchronously across a switch and asserts `'snv'` never appears and the FilterToolbar does not mount; plus the empty-case fallback and "does not override a tab the user picked while the counts were loading".
- `tests/renderer/components/shortlist/ShortlistPanel.test.ts`: skeleton before the query starts; summary slot always rendered.
- E2E (for integration with Track 6's `tests/e2e/renderer-perf-phase1.e2e.ts`): add a `case-switch` step to `CASE_TABLE_STEPS` that clicks the second perf case in the sidebar while the Shortlist tab is active, then asserts `allShifts <= 0.02` and that `.shortlist-panel` stays visible in every sampled frame. Not added here because the interaction-gate helpers only exist on `ci/quality-gates`.
