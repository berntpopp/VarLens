# Track 2 — mobile table render perf and CLS: before / after

Branch `perf/mobile-table-render`. Web build (`VARLENS_WEB_BASE=/ npm run build:web`) served on :8820, schema `web_dev_track2` (copy of the dev data: LB26-0060 6,399 SNV, cohort of 3 cases), 75 ms API latency. "Before" = `main` 8a662b89 built the same way.

## Lighthouse user flow (median of 3; `perf-evidence/flow.mjs` trimmed to home → open case + SNV tab → snapshot → switch to cohort → snapshot)

| Step | Metric | Before | After (low host load, load avg ≈ 9) | After (final build, load avg ≈ 22) |
|---|---|---:|---:|---:|
| Mobile: open case + SNV tab | TBT | **1,944 ms** | **564–623 ms** | 1,201 ms |
| | CLS | 0.117 | 0.005 | **0** |
| | INP | 839 ms | 356–387 ms | 621 ms |
| | Perf score | 43 | 72–74 | 56 |
| Mobile: switch to cohort | TBT | 1,069 ms | 344–384 ms | 838 ms |
| | CLS | **0.180** | **0** | **0** |
| Desktop: open case + SNV tab | TBT / CLS | 256 ms / 0.001 | — | **66 ms / 0** |
| Desktop: switch to cohort | CLS | **0.133** | — | **0.008** |
| Snapshots | A11y | 100 case (mobile), 97 cohort / desktop | — | unchanged (97 = pre-existing contrast: CaseList subtitle, cohort field labels) |

The last column was measured while other tracks loaded the 32-core host (load average 22); Lighthouse TBT under simulated 4× throttling scales with host contention, so compare it with the CPU profile below rather than with the first "after" column.

## Controlled CPU profile (Playwright, 412×823 mobile, CDP 4× CPU throttle, `profile.cjs`)

| Interaction | TBT before | TBT after | Long tasks after |
|---|---:|---:|---|
| Open case (Shortlist tab, hidden SNV table) | 520–792 ms | **164 ms** | 149, 98, 67 |
| SNV/Indel tab first show | 589–802 ms | **216 ms** | 266 |
| Switch to cohort | 411–635 ms | **127 ms** | 147, 80 |

Vue component instances for home → open case → SNV tab: VOverlay 230 → 42, VIcon/VSvgIcon 594 → 153 each, VTooltip 128 → 29, VMenu 96 → 7.

## Electron interaction gate (Track 6, `renderer-perf-phase1.e2e.ts` "interaction quality", run against this branch)

| Step | allShifts before | after |
|---|---:|---:|
| cohort-sort | 0.046 (rounds 0.011 / 0.072 / 0.046) | **0** (0 / 0 / 0) — XPASS of the known failure |
| case-sort | 0.0099 | **0** |
| other steps | ≤0.003 | ≤0.003 |

## Shortlist case switch

See `shortlist-before.md` / `shortlist-after.md`: open-case CLS 0.113 → 0 (mobile), Shortlist hidden on switch 149–327 ms → 0, CLS 0 on every switch, requests per switch 4–7 → 2–3.

## Verification

axe (WCAG 2.2 AA + best-practice) on shortlist, shortlist actions menu, case table, ACMG menu, header filter menu, cohort table, cohort ACMG menu: identical before/after (0 serious/critical; only pre-existing `region` / `empty-table-header`, moderate/minor). Row DOM before/after is identical except for the removed per-row tooltip/menu attributes; screenshots pixel-identical apart from timestamps.
