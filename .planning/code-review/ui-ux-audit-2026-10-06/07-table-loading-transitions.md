# 07 — Table loading transitions (case SNV/Indel, Shortlist, Cohort)

**Date:** 2026-10-06 · **Build:** v0.72.0 (web, `http://localhost:8787/`, dev server adds 75 ms per API call) · **Case:** LB26-0060 (6,399 SNV/Indel) · **Cohort:** GRCh38, 3 cases, 15,626 variants
**Method:** headless Chromium (Playwright 1.63) at 1600×1000. An init script records one DOM sample per animation frame (data-row count, loading row, skeletons, header progress bar, tbody height and opacity, footer text, wrapper `scrollTop`, per-column `th` widths, sort state, first-row signature, `activeElement`). It also records layout-shift (with sources), long tasks, Event Timing (INP) and every `fetch` (start, end, body). A CDP `Page.startScreencast` filmstrip runs alongside. Each interaction ran under 4 conditions: **d0** (75 ms dev latency only), **d300** (+300 ms per data API call via `page.route`), **d1000** (+1000 ms) and **cpu4** (`Emulation.setCPUThrottlingRate 4`, no extra latency). Before each interaction the table body was scrolled to 200 px so scroll resets show up. Out-of-order responses were tested by delaying only the **first** data request by 1.5–2 s.

Artifacts (all under `table-loading/`):
- `*.png` are contact sheets, one per interaction per condition. Every `__d300` sheet is included, plus `__d0` for the key interactions and `__d1000`/`__cpu4` for `snv-next`, `snv-preset-high` and `co-next`. Each sheet has the pre-action frame plus one frame per visual state change, labelled with ms after the action.
- `stale-*__race.png` are the out-of-order filmstrips.
- `frames/*.png` are single key frames (skeleton swap, wrong rows after a race, double skeleton on Clear, cohort footer running ahead of the rows).
- `data/results-{d0,d300,d1000,cpu4,stale}.json` and `data/log-*.txt` hold the raw per-interaction metrics.
- `harness/*.js` is the reproducible harness (`run.js <d0|d300|d1000|cpu4>`, `stale.js`). Its paths point at the session scratchpad, so edit `DIR`/`OUTDIR` before you re-run it.

---

## 1. Verdict

| | Before (measured) | Expected after the spec in §5 |
|---|---|---|
| Case SNV/Indel table | **3.5 / 10** | 9 / 10 |
| Shortlist | **6 / 10** | 9 / 10 |
| Cohort table | **6 / 10** (search is not applied at all, see R6) | 9 / 10 |
| **Overall "Table loading smoothness"** | **4.5 / 10** | **≈ 9 / 10** |

The single biggest problem is that **every SNV/Indel refetch blanks the body.** Page, sort, page size, search, preset and clear all replace the rows with a 10-row skeleton for the whole round trip: 100–440 ms at d0, 400–690 ms at d300 and 1.1–1.4 s at d1000. On each swap the column widths recompute (80–134 px of horizontal jitter), and the scroll position falls back to 0 only by accident (the shorter skeleton body clamps it).

The cohort table runs on the same pagination composable but has no `#loading` slot. Without meaning to, it already does stale-while-revalidate: rows stay up and a 4 px bar runs. It shows no blank body, but it also has no dimming, so for up to 1.3 s the footer reads "51–100" while page 3's rows are still on screen.

Two correctness bugs come out of the loading path:
- **Stale responses render** in both case and cohort tables: wrong rows stay on screen under a correct footer, permanently.
- **"Clear" fires 2 or 3 identical queries.** On the case view it briefly shows **"0-NaN of NaN"**.

**Cohort full-text search never issues a request.** The chip says "Search MUC5" but the table stays at 15,626 rows.

## 2. Per-interaction measurements

Column notes:
- **Feedback** is the first frame where anything in the table region changes (rows, bar, skeleton, footer, sort icon).
- **First new rows** is the first frame that shows the new result set. "–" means the first rows are identical (same page 1 after a page-size change or a sort tie), or no result change happened.
- **Blank body** is the time with no data rows on screen while the table had rows before or after.
- **Flashes** is the number of distinct visual states after the baseline. The ideal is 1–2 (old → dimmed → new).
- **Outer jump** is the change in the `v-data-table` box height. **tbody** is the min–max body height during the transition; the wrapper is flex-fixed, so this shows up as scroll clamping rather than page movement.
- **Col jitter** is the largest per-column `th` width change in any frame against the pre-action layout.
- **CLS** is the maximum across conditions, counting only shifts without recent input.
- **Score** is a heuristic 0–10: −3 for any blank ≥150 ms (−1 more if >500 ms), −1 col jitter >40 px, −1 CLS >0.01, −1 duplicate request, −1 exposed to stale-response race, −1 feedback >300 ms, −1 footer shows ∅/NaN, −0.5 INP >200 ms at 4× CPU. Cohort search rows are capped at 2 because the feature doesn't work.

Prefixes: `snv-` = case view SNV/Indel tab, `sl-` = Shortlist tab, `co-` = cohort view.

| Interaction | Feedback ms (d0/d300) | First new rows ms (d0/d300/d1000) | Blank body ms (d0/d300/d1000) | Flashes (d300 sequence) | Outer jump px / tbody px | CLS max | Col jitter px | Scroll before→after | Data reqs (d300) | INP ms (d0/cpu4) | Footer sequence (d300) | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| snv-tab-in | 201 / 191 | 201 / 191 / 203 | 192 / 176 / 196 | 1 (none > data) | – / body 900–900 | 0 | 0 | →0 | 0 | 208 / 800 | 1-25 of 6399 | **6.5** |
| snv-next | 71 / 66 | 274 / 569 / 1290 | 202 / 502 / 1210 | 3 (data > skeleton+bar > data) | 0 / body 552–900 | 0.009 | 134 | 200→0 | 2 | 64 / 192 | 1-25 of 6399 → 26-50 of 6399 | **3.5** |
| snv-next2 | 178 / 163 | 178 / 163 / 174 | 0 / 0 / 0 | 2 (data) | 0 / body 900–900 | 0 | 80 | 200→200 | 1 | 160 / 600 | 26-50 of 6399 → 51-75 of 6399 | **7.5** |
| snv-prev | 78 / 95 | 270 / 586 / 1257 | 192 / 491 / 1182 | 2 (data > skeleton+bar > data) | 0 / body 552–900 | 0.009 | 134 | 200→0 | 2 | 72 / 200 | 51-75 of 6399 → 26-50 of 6399 | **4.5** |
| snv-last | 89 / 72 | 291 / 560 / 1271 | 203 / 488 / 1188 | 3 (data > skeleton+bar > data) | 0 / body 552–900 | 0.0054 | 134 | 200→0 | 1 | 72 / 192 | 26-50 of 6399 → 6376-6399 of 6399 | **4.5** |
| snv-first | 77 / 70 | 251 / 590 / 1250 | 173 / 520 / 1169 | 2 (data > skeleton+bar > data) | 0 / body 552–900 | 0.0065 | 129 | 200→0 | 2 | 64 / 208 | 6376-6399 of 6399 → 1-25 of 6399 | **3** |
| snv-ipp50 | 84 / 81 | – / – / – | 302 / 615 / 1323 | 2 (data > skeleton+bar > data) | 0 / body 552–1800 | 0.0095 | 134 | 200→0 | 2 | 72 / 224 | 1-25 of 6399 → 1-50 of 6399 | **3** |
| snv-sort-gene-asc | 119 / 127 | 470 / 737 / 1419 | 351 / 610 / 1297 | 2 (data > skeleton+bar > data) | 0 / body 552–1800 | 0.0077 | 134 | 200→0 | 2 | 104 / 408 | 1-50 of 6399 | **3.5** |
| snv-sort-gene-desc | 117 / 120 | 434 / 724 / 1421 | 317 / 604 / 1305 | 2 (data > skeleton+bar > data) | 0 / body 552–1800 | 0.0096 | 99 | 200→0 | 2 | 104 / 392 | 1-50 of 6399 | **3.5** |
| snv-sort-pos-2nd | 116 / 108 | – / – / – | 351 / 619 / 1291 | 2 (data > skeleton+bar > data) | 0 / body 552–1800 | 0.0095 | 128 | 200→0 | 2 | 104 / 304 | 1-50 of 6399 | **3.5** |
| snv-search-slow | 1229 / 1212 | 1380 / 1663 / 2348 | 151 / 451 / 1141 | 2 (data > skeleton+bar > data) | 34 / body 180–1800 | 0.0213 | 128 | 200→0 | 1 | 40 / 128 | 1-50 of 6399 → 1-5 of 5 | **3** |
| snv-search-clear | 86 / 73 | 458 / 667 / 1378 | 372 / 595 / 1311 | 2 (data > skeleton+bar > data) | 34 / body 180–1800 | 0.0101 | 128 | 0→0 | 2 | 72 / 192 | 1-5 of 5 → 1-50 of 6399 | **3** |
| snv-search-paste | 652 / 645 | 771 / 1067 / 1769 | 119 / 422 / 1122 | 2 (data > skeleton+bar > data) | 34 / body 36–1800 | 0.0622 | 128 | 200→0 | 1 | 0 / 0 | 1-50 of 6399 → 1-1 of 1 | **3** |
| snv-search-clear2 | 76 / 69 | 416 / 679 / 1378 | 340 / 610 / 1313 | 2 (data > skeleton+bar > data) | 34 / body 36–1800 | 0.0101 | 128 | 0→0 | 2 | 64 / 168 | 1-1 of 1 → 1-50 of 6399 | **3** |
| snv-zero | 645 / 659 | 761 / 1094 / 1752 | 116 / 435 / 1106 | 2 (data > skeleton+bar > empty) | 34 / body 215–1800 | 0.0597 | 128 | 200→0 | 1 | 0 / 0 | 1-50 of 6399 → 0-0 of 0 | **3** |
| snv-back-from-zero | 68 / 63 | 372 / 668 / 1417 | 362 / 661 / 1417 | 2 (empty > skeleton+bar > data) | 34 / body 215–1800 | 0.0101 | 128 | 0→0 | 2 | 64 / 176 | 0-0 of 0 → 1-50 of 6399 | **3** |
| snv-preset-high | 398 / 384 | 695 / 980 / 1746 | 297 / 596 / 1313 | 2 (data > skeleton+bar > data) | 34 / body 552–1800 | 0.009 | 128 | 200→0 | 2 | 56 / 264 | 1-50 of 6399 → 1-50 of 184 | **2.5** |
| snv-preset-clinvar | 371 / 375 | 469 / 774 / 1481 | 97 / 399 / 1100 | 2 (data > skeleton+bar > data) | 0 / body 108–1800 | 0.0034 | 128 | 200→0 | 1 | 40 / 152 | 1-50 of 184 → 1-3 of 3 | **4** |
| snv-clear-filters | 82 / 71 | 221 / 479 / 1168 | 436 / 409 / 1107 | 3 (data > skeleton+bar > data) | 34 / body 108–1800 | 0.011 | 134 | 0→0 | 4 (dup 1) | 64 / 168 | 1-3 of 3 → 0-NaN of NaN → 1-50 of 6399 | **2** |
| snv-row-open | – / – | – / – / – | 0 / 0 / 0 | 0 (data) | 0 / body 1800–1800 | 0.0075 | 0 | 0→0 | 0 | 96 / 384 | 1-50 of 6399 | **9.5** |
| snv-row-close | – / – | – / – / – | 0 / 0 / 0 | 0 (data) | 0 / body 1800–1800 | 0 | 0 | 0→0 | 0 | 88 / 336 | 1-50 of 6399 | **9.5** |
| snv-tab-out | 96 / 102 | 279 / 560 / 1248 | 268 / 551 / 1234 | 2 (none > skeleton+bar > data) | – / body 2874–2874 | 0.0023 | 0 | →0 | 1 | 88 / 248 | 1-50 of 50 | **5.5** |
| sl-preset-change | – / 58 | – / 525 / – | – / 467 / – | 2 (data > skeleton+bar > data) | 0 / body 2874–2874 | 0 | 0 | 0→0 | 1 | – / 112 | 1-50 of 50 → ∅ → 1-50 of 200 | **6** |
| sl-refresh | 58 / 49 | – / – / – | 203 / 464 / 1182 | 2 (data > skeleton+bar > data) | 0 / body 2874–2874 | 0.002 | 0 | 200→0 | 1 | 40 / 104 | 1-50 of 200 → ∅ → 1-50 of 200 | **5.5** |
| sl-ipp25 | 69 / 73 | – / – / – | 0 / 0 / 0 | 1 (data) | 0 / body 1437–2874 | 0 | 0 | 200→200 | 0 | 40 / 136 | 1-50 of 200 → 1-25 of 200 | **10** |
| sl-next | 92 / 86 | 92 / 86 / 85 | 0 / 0 / 0 | 1 (data) | 0 / body 1437–1437 | 0 | 50 | 200→200 | 0 | 64 / 208 | 1-25 of 200 → 26-50 of 200 | **8.5** |
| co-enter | 112 / 110 | 440 / 706 / 1394 | 419 / 684 / 1375 | 2 (none > loadtext+bar > data) | – / body 36–1800 | 0.0506 | 0 | →0 | 2 | 24 / 80 | 0-0 of 0 → 1-50 of 15626 | **4** |
| co-next | 240 / 193 | 240 / 193 / 190 | 0 / 0 / 0 | 1 (data) | 0 / body 1800–1800 | 0 | 89 | 200→200 | 1 | 208 / 632 | 1-50 of 15626 → 51-100 of 15626 | **7.5** |
| co-next2 | 199 / 172 | 199 / 172 / 194 | 0 / 0 / 0 | 1 (data) | 0 / body 1800–1800 | 0 | 76 | 200→200 | 1 | 160 / 728 | 51-100 of 15626 → 101-150 of 15626 | **7.5** |
| co-prev | 117 / 101 | 314 / 590 / 1314 | 0 / 0 / 0 | 2 (data > data+bar > data) | 0 / body 1800–1800 | 0 | 76 | 200→200 | 2 | 120 / 408 | 101-150 of 15626 → 51-100 of 15626 | **7.5** |
| co-last | 133 / 113 | 304 / 581 / 1283 | 0 / 0 / 0 | 2 (data > data+bar > data) | 0 / body 936–1800 | 0 | 125 | 200→200 | 1 | 120 / 400 | 51-100 of 15626 → 15601-15626 of 15626 | **7.5** |
| co-first | 97 / 74 | 296 / 554 / 1276 | 0 / 0 / 0 | 2 (data > data+bar > data) | 0 / body 936–1800 | 0 | 125 | 200→200 | 2 | 88 / 256 | 15601-15626 of 15626 → 1-50 of 15626 | **7.5** |
| co-ipp25 | 108 / 104 | – / – / – | 0 / 0 / 0 | 2 (data > data+bar > data) | 0 / body 900–1800 | 0.0425 | 125 | 200→200 | 2 | 120 / 424 | 1-50 of 15626 → 1-25 of 15626 | **6.5** |
| co-sort-gene-asc | 93 / 66 | 238 / 508 / 1213 | 0 / 0 / 0 | 2 (data > data+bar > data) | 0 / body 900–900 | 0.0018 | 89 | 200→0 | 2 | 80 / 256 | 1-25 of 15626 | **7.5** |
| co-sort-gene-desc | 84 / 69 | 241 / 526 / 1235 | 0 / 0 / 0 | 2 (data > data+bar > data) | 0 / body 900–900 | 0.0028 | 53 | 200→0 | 2 | 72 / 224 | 1-25 of 15626 | **7.5** |
| co-sort-pos-2nd | 81 / 68 | 246 / 519 / 1217 | 0 / 0 / 0 | 2 (data > data+bar > data) | 0 / body 900–900 | 0.001 | 78 | 200→0 | 2 | 88 / 232 | 1-25 of 15626 | **7.5** |
| co-search-slow | – / – | – / – / – | 0 / 0 / 0 | 0 (data) | 34 / body 900–900 | 0.0059 | 0 | 200→200 | 0 | 24 / 88 | 1-25 of 15626 | **2** |
| co-search-clear | 370 / 372 | – / – / – | 0 / 0 / 0 | 2 (data > data+bar > data) | 34 / body 900–900 | 0 | 0 | 200→200 | 2 | 48 / 200 | 1-25 of 15626 | **2** |
| co-zero | – / – | – / – / – | 0 / 0 / 0 | 0 (data) | 34 / body 900–900 | 0.0481 | 0 | 200→200 | 0 | 0 / 0 | 1-25 of 15626 | **2** |
| co-back-from-zero | 376 / 372 | – / – / – | 0 / 0 / 0 | 2 (data > data+bar > data) | 34 / body 900–900 | 0 | 0 | 200→200 | 2 | 48 / 128 | 1-25 of 15626 | **2** |
| co-preset-high | 392 / 371 | 528 / 791 / 1520 | 0 / 0 / 0 | 2 (data > data+bar > data) | 34 / body 900–900 | 0 | 89 | 200→200 | 2 | 56 / 208 | 1-25 of 15626 → 1-25 of 498 | **6.5** |
| co-clear-filters | 102 / 79 | 283 / 517 / 1234 | 0 / 0 / 0 | 2 (data > data+bar > data) | 34 / body 900–900 | 0.0105 | 48 | 200→200 | 4 (dup 2) | 88 / 328 | 1-25 of 498 → 1-25 of 15626 | **5.5** |
| co-row-expand | 57 / 54 | – / – / – | 0 / 0 / 0 | 0 (data) | 0 / body 900–1050 | 0.1132 | 0 | 200→0 | 0 | 32 / 88 | 1-25 of 15626 | **8.5** |
| co-row-open | – / – | – / – / – | 0 / 0 / 0 | 0 (data) | 0 / body 1050–1050 | 0 | 0 | 0→0 | 0 | 72 / 344 | 1-25 of 15626 | **9.5** |
| co-row-close | – / – | – / – / – | 0 / 0 / 0 | 0 (data) | 0 / body 1050–1050 | 0 | 0 | 0→0 | 0 | 72 / 200 | 1-25 of 15626 | **10** |

`sl-preset-change` only has d300 and cpu4 data; the d0 and d1000 runs hit a locator bug in the harness (fixed before the d300 re-run).

### 2.1 What the filmstrips show (pointers)

| Interaction | Sheet | What you see |
|---|---|---|
| SNV next page | `snv-next__d300.png`, `__d1000`, `__cpu4`; `frames/snv-next-d300-{0,1,2}-*.png` | Full table → 10 grey skeleton bars with **narrower columns** (headers re-flow) → rows. Then a second repaint ~400 ms later when annotation icons hydrate (`annotations/batchGet` runs after the query). |
| SNV next again (prefetch hit) | `snv-next2__d300.png` | No skeleton (served from the prefetch cache), but the rows still swap after a **~150–180 ms long task**. The new page keeps the old scroll offset (200 px), unlike the cache-miss path, which lands at 0. |
| SNV sort / page size | `snv-sort-gene-asc__d300.png`, `snv-ipp50__d300.png` | Same skeleton swap. The sort arrow does update right away (~110 ms), but the body blanks for ~600 ms at d300. |
| SNV search (slow typing, paste) | `snv-search-slow__d300.png`, `snv-search-paste__d300.png` | Nothing happens for 300 ms after the last keystroke (debounce). Then the applied-filters bar **slides in and pushes the table down 34 px** (CLS 0.012–0.062, sources = `th` cells). Then skeleton, then 5 rows (tbody collapses 1800 → 180 px). |
| SNV zero results → back | `snv-zero__d300.png`, `snv-back-from-zero__d300.png` | rows → skeleton → empty state. Back goes empty → skeleton → rows (blank 660 ms at d300). The empty state itself is well designed. |
| SNV preset chip | `snv-preset-high__d300.png` | Nothing in the table for **~380 ms** after the click (300 ms debounce applied to a discrete click). Then the chip bar slides in, then skeleton, then rows. |
| SNV Clear | `snv-clear-filters__d300.png`, `frames/clear-filters-second-skeleton.png` | **Two skeleton cycles at d0.** At d300/d1000/cpu4 the footer reads **"0-NaN of NaN"** for ~450 ms. 4 requests (2 identical). Focus drops to `<body>`. |
| Tab Shortlist ↔ SNV | `snv-tab-out__d300.png`, `snv-tab-in__d300.png` | Into Shortlist: the panel is **re-mounted** (`v-if`), so you get a skeleton and a refetch every time (≈560 ms at d300, 1.2 s at d1000). Into SNV: instant (kept alive by `v-show`), but a ~170–200 ms render long task. |
| Shortlist refresh / preset change | `sl-refresh__d300.png`, `sl-preset-change__d300.png` | The whole table is replaced by a 5-row skeleton plus its own bar, the **footer disappears**, and scroll resets to 0. Client-side paging and page size are instant (good). |
| Cohort enter | `co-enter__d300.png` | Empty table with "Loading…" text row (no skeleton) for 680 ms at d300, footer "0-0 of 0" first. |
| Cohort next / last / prev | `co-next__d300.png`, `co-prev__d300.png`, `frames/cohort-prev-footer-ahead-of-rows.png` | Old rows stay (good), plus the 4 px header bar. But the footer and page number jump to the new page immediately while the old page's rows stay up with **no dimming**. The new page is shown **mid-scroll** (no reset). Prefetch hits block the main thread ~170–210 ms (INP 190–210 ms at d0, 630–730 ms at cpu4). |
| Cohort sort | `co-sort-*__d300.png` | Old rows plus bar, columns re-flow 50–90 px on arrival. Only the **first** sort key is sent to the server even though the header shows multi-sort priorities. |
| Cohort search / zero | `co-search-slow__d300.png`, `co-zero__d300.png` | Chip bar slides in (CLS 0.044), **no request ever fires**, and rows stay unfiltered. |
| Cohort Clear | `co-clear-filters__d300.png` | 4–5 requests (2–3 identical) for one click. |
| Cohort row expand | `co-row-expand__d300.png` | Carriers load in place. The expanded row grows by 150 px (CLS 0.113 at d1000, when the growth lands >500 ms after the click). |
| Row details open/close | `snv-row-open__d300.png`, `co-row-open__d300.png` | The panel overlays the table: no table layout change, no refetch. Good (score 9.5–10). |

### 2.2 Out-of-order response test (`data/results-stale.json`)

The first data request was held for 1.5–2 s and everything after it went through immediately.

| Scenario | Sequence | Result |
|---|---|---|
| `stale-snv-page` (`stale-snv-page__race.png`) | Last page (slow) → 250 ms later First page (fast) | First page renders at 548 ms. At 1763 ms the **last-page rows replace it**. Footer stays "1-25 of 6399", page control stays on page 1. **Stale rows rendered permanently.** |
| `stale-snv-filter` (`stale-snv-filter__race.png`, `frames/stale-filter-final-wrong-rows.png`) | Preset HIGH (slow) → search "FLNB" (fast) | HIGH+FLNB correctly returns 0 and the empty state shows. Then at 2.56 s the stale HIGH-only response lands: the table shows **184 HIGH variants (LIAT1, MUC6, …) while the search box says FLNB and both chips are active.** A follow-up prefetch for the stale set is also issued. In a clinical tool this is a "wrong data under the right filter" bug. |
| `stale-co-page` (`stale-co-page__race.png`) | Same as `stale-snv-page` on the cohort view | Same failure: chrY rows under "1-25 of 15626". |
| `stale-sl-preset` | Preset A (slow) → preset B (fast) | **Correct.** `useShortlistQuery` drops the stale response (request-id guard). Only the transient footer disappears. |

There is also no `AbortController` anywhere on the table path (`fetch` entries carry no `signal`). Superseded requests still run to completion server-side.

## 3. Root causes (file:line)

| # | Symptom(s) | Root cause |
|---|---|---|
| **R1** | Body blanks on every SNV refetch; 3 visual states; scroll clamp to 0; header re-flow | `VariantTable.vue:223-226` provides a `#loading` slot. In Vuetify 4.2.1, `VDataTableRows` renders **only** the loading row whenever `loading && (!items.length \|\| slots.loading)` (`node_modules/vuetify/lib/components/VDataTable/VDataTableRows.js:76`). So passing a loading slot turns every refetch into "rows removed, skeleton in". The comment above the slot ("to prevent layout shift") is the opposite of what happens. `VariantTable.vue:16` binds `:loading="loading"` straight from `useOffsetPagination.ts:146` (`loading.value = true` on every load, no delay). |
| **R2** | Column jitter (50–134 px per data change, also on cache hits and in cohort) | `data-table-shared.css:119-125` leaves `table-layout: auto` with `max-width: 200px` and `white-space: nowrap`, and most columns have no `width` (`variant-table/columns.ts:53-60` only pins annotations/ref/alt/OMIM; cohort columns are similar). Column widths therefore follow the content of each page. The skeleton row (`colspan` = all) collapses them to header widths. |
| **R3** | Stale rows/filters rendered (§2.2); bar disappears while a newer request is still pending | `useOffsetPagination.ts:145-204` (`loadPage`) has no request token or abort. Every caller commits `items`/`totalCount` on resolve, and the first `finally` sets `loading=false`. Both `VariantTable` (`useVariantData.ts:63-123`) and `CohortTable` (`CohortTable.vue:352-389`) inherit this. The shortlist already has the right pattern (`useShortlistQuery.ts:83-110`). |
| **R4** | "0-NaN of NaN" footer | `useOffsetPagination.ts:176` decides `skipCount` before the `await`. `:187-190` then writes `totalCount.value = cachedTotalCount!`, but a concurrent `invalidateAndReload` → `resetCount()` (`:210-223`) has nulled it in the meantime. The prefetch path at `:161` (`cachedTotalCount ?? result.total_count`, and `total_count` is absent when `skipCount`) has the same hazard. |
| **R5** | Clear fires 2–5 queries, two skeleton cycles | Case view: `FilterToolbar.vue:666-671` (`handleClearAll`) runs `handleDslClear()` (emits), then `clearAllFilters()` (→ debounced emit → `useVariantData.ts:168-178` `invalidateAndReload`), then emits `clear-column-filters` → `useColumnFilters.ts:34-36` always assigns a **new `{}`** even when already empty → `useVariantData.ts:181-185` schedules a second debounced `invalidateAndReload` 300 ms later. Cohort: `CohortTable.vue:514-524` calls `invalidateAndReload()` directly, **and** the filter-bar watchers (`CohortFilterBar.vue:465-470`) emit `filter-change` → another one, **and** the column-filter clear → a third (`CohortTable.vue:536-541`). |
| **R6** | Cohort search does nothing (no request), chip says it's applied | `CohortFilterBar.vue:467-470` watches `filters`, impact/AF/CADD presets, but **not `searchTerm`**. `useDslFilterIntegration.ts:52-56` writes `searchTerm` on each FTS keystroke without calling `emitFilters()`. The case view gets the search through `useFilterState.ts:112-115` (the search lives inside `filters`). The term only reaches the server on the next unrelated reload. (Separately, one slow-typing run lost a keystroke, "MUC5" → "MC5", in the cohort field. It didn't reproduce; worth a follow-up while fixing R6.) |
| **R7** | 34 px push and CLS 0.01–0.06 on the first filter / search / preset, and again on clear | `SlimFilterToolbar.vue:124-151`: the applied-filters bar is `v-if` inside `v-expand-transition`. It animates height and pushes the table down. Shared by case and cohort toolbars. |
| **R8** | Shortlist tab re-fetches and skeletons on every visit; the shortlist body is swapped wholesale | `CaseView.vue:454-455` mounts `ShortlistPanel` with `v-if` (comment says "owns its own query lifecycle"). `ShortlistPanel.vue:117-149` uses a `v-if/v-else-if` chain, so `loading` unmounts `ShortlistTable` (footer, scroll, client-side page, sort all lost) and shows a 5-row skeleton plus an extra `v-progress-linear`. |
| **R9** | Discrete actions (preset chip, ACMG chip) feel laggy: ~380 ms to first feedback | `useFilterState.ts:109-115` applies the 300 ms `APP_CONFIG.DEBOUNCE_MS` (`shared/config/app.config.ts:8`) to **all** filter changes, including single clicks. That debounce is only appropriate for keystrokes. |
| **R10** | Two-phase repaint (rows, then annotation icons ~400 ms later); prefetch competes with hydration | `useVariantData.ts:189-204` loads annotations only after `variants` commits. `useOffsetPagination.ts:196` fires the next-page prefetch at the same moment, so at d300 the batch call and the prefetch race for the same connection budget. |
| **R11** | Back/forward paging is not instant; prefetch hits still cost a 150–210 ms long task | `useOffsetPagination.ts:155` **deletes** a cache entry when it's consumed, and only the next page is prefetched (`:95-125`). So "previous" always misses (`snv-prev`/`co-prev`: full round trip). The cache-hit swap is dominated by row render cost (per-cell `v-tooltip`s in `VariantTable.vue:152-182`, cell components): INP 160–210 ms at d0, 600–730 ms at cpu4. |
| **R12** | Inconsistent scroll after paging (cache miss → 0 by accident; cache hit and cohort → stays at 200 px on a new page); scroll reset on shortlist refresh | No explicit scroll policy anywhere. The reset is a side effect of R1 (shorter skeleton body clamps `scrollTop`). |
| **R13** | Footer and page number lie during SWR (cohort shows "51–100" over page-3 rows for up to 1.3 s) | Vuetify's `v-model:page` updates the footer before data arrives. Nothing marks the rows as stale (no dim, no `aria-busy`). |
| **R14** | Accessibility of loading | No `aria-busy` on any table (grep: none in `VariantTable.vue`, `CohortDataTable.vue`, `ShortlistTable.vue`). The only live region is the results chip (`SlimFilterToolbar.vue:25`, `aria-live` on a chip whose label changes; not announced reliably and not present on Shortlist). Clear moves focus to `<body>` (`snv-clear-filters`, `co-clear-filters` focus trace). The cohort default empty state is Vuetify's "No data available" (`CohortDataTable.vue` has no `#no-data` slot), unlike the case view's designed empty state (`VariantTable.vue:228-245`). `prefers-reduced-motion` is only honoured by the cohort rebuild shimmer (`CohortTable.vue:798-801`). |
| **R15** | Cohort multi-sort shows priorities but sorts by one key | `CohortTable.vue:364-365` uses `sortItems[0]` only (parity bug, adjacent to loading). |

## 4. Cohort-parity matrix (current)

| Behaviour | Case SNV/Indel | Cohort | Shortlist |
|---|---|---|---|
| Refetch keeps rows (SWR) | ✗ skeleton swap (R1) | ✓ by accident (no `#loading` slot) | ✗ whole table swap (R8) |
| Stale-request guard | ✗ | ✗ | ✓ |
| First-load placeholder | skeleton (10 rows, wrong height) | "Loading…" text row | skeleton (5 rows) |
| Empty state | designed, with Clear button | Vuetify default text | designed (plain) |
| Footer during load | stable, NaN on Clear race | stable, but ahead of rows | disappears |
| Search applies | ✓ (debounced 300 ms) | ✗ (R6) | n/a |
| Clear = 1 request | ✗ (2) | ✗ (3) | n/a |
| Multi-sort sent to server | ✓ | ✗ first key only (R15) | client |
| Scroll policy | accidental reset | none (stays mid-page) | resets on refresh |

The spec below fixes all three surfaces through **one composable and one shared table-state wrapper**, so parity is structural rather than maintained by hand (project rule: case and cohort ship identically).

## 5. "Smooth table" design

### 5.1 Behavioural contract (all three tables)

| State | What the user sees | Timing |
|---|---|---|
| **First load** (no rows ever committed for this case or cohort query) | Skeleton rows **at the real row height** (compact = 36 px; Shortlist ≈ 57 px), `itemsPerPage` of them, capped at what fits the viewport. Real header with real column widths. Footer shows "Loading…" in the count slot. | Skeleton only after 150 ms (a fast first load goes straight to rows). |
| **Refetch** (page, sort, page size, filter, search, refresh, annotation-backed reload) | **Previous rows stay rendered.** After **150 ms**, if no response yet, the tbody fades to `opacity: .55` (120 ms ease) and a 2 px top bar appears. The bar stays at least **300 ms** once shown (no blink). The sort arrow and the pressed pager button update immediately (optimistic). | Responses under 150 ms show no indicator at all. That covers all prefetch hits and most d0 calls. |
| **Commit** | New rows replace old in one frame. Opacity returns to 1 (no fade-in of the new rows, which is perceived as lag). Column widths unchanged (fixed layout). Scroll set by policy (below). Footer total updates once. | One state change. |
| **Empty result** | The designed empty state, **inside a body of the same min-height** as the last data body (≥ 5 rows), so the footer doesn't jump. | Same commit frame. |
| **Error** | Keep the previous rows, un-dim them, show an inline `v-alert` with Retry above the table. Never wipe to `[]` / `0`. | — |

**Scroll policy (explicit):** page, sort, page size, filter and search commit → `wrapper.scrollTop = 0` (instant, after the commit `nextTick`). Refresh, annotation-backed reload and tab return → preserve `scrollTop`. Same on case and cohort.

**Footer:** always render `committedRange of lastKnownTotal`. While a count is pending, show the last known total prefixed with `≈` and give the footer `aria-busy="true"`. Never render a count derived from `null` (fixes "0-NaN of NaN"). Page buttons reflect the **requested** page (optimistic); the range text reflects the **committed** page, so they never disagree with the rows on screen.

**Requests:**
- Latest-request-wins token on every load. A superseded response is dropped and **does not** clear `loading`.
- In web mode, pass an `AbortSignal` through `httpInvoke` (`web/client/api.ts:101-108`) so superseded queries are cancelled. On Electron IPC the token alone is enough.
- Keystrokes: debounce 250 ms.
- Discrete clicks (preset chip, ACMG chip, Clear, drawer Apply): **flush immediately**.
- One reload per user action (coalesce in a microtask).

**Cache:**
- LRU of 6 pages keyed by `offset:limit:sort:filterKey`. Entries are **not** deleted on hit.
- Prefetch next **and** previous page after annotations for the current page are requested, via `requestIdleCallback` (`setTimeout(…, 0)` fallback).
- Invalidate on filter change, case change and annotation-backed changes.

**A11y:**
- `aria-busy="true"` on the table wrapper while a refetch is in flight.
- One shared visually-hidden `role="status" aria-live="polite"` region per view. It announces "Showing 1–50 of 184 variants" (or "No variants match the current filters") **400 ms after commit**, deduplicated.
- Focus: keep focus on the control that triggered the action. When that control disappears (Clear), move it to the search field.
- `prefers-reduced-motion: reduce` → no opacity transition and a static (non-animated) bar.

**Layout stability:**
- `table-layout: fixed` with explicit widths for every column (or measured-and-pinned widths, see 5.3). Body `min-height` set from the last committed row count.
- The applied-filters bar gets a **reserved fixed-height row**: render it always and show a muted "No filters applied" text when empty. Alternatively, move the chips into the existing preset row. No `v-expand-transition` height animation.

### 5.2 New composables

`src/renderer/src/composables/useDelayedFlag.ts` (≈40 lines) exposes a busy flag with show-delay and minimum-visible time:

```ts
import { ref, watch, onBeforeUnmount, type Ref } from 'vue'

export function useDelayedFlag(source: Ref<boolean>, { delay = 150, minVisible = 300 } = {}) {
  const visible = ref(false)
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let shownAt = 0
  const clear = () => { if (showTimer) clearTimeout(showTimer); if (hideTimer) clearTimeout(hideTimer); showTimer = hideTimer = null }
  watch(source, (on) => {
    if (on) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
      if (!visible.value && !showTimer) showTimer = setTimeout(() => { showTimer = null; visible.value = true; shownAt = performance.now() }, delay)
    } else {
      if (showTimer) { clearTimeout(showTimer); showTimer = null } // fast response → never shown
      if (visible.value) {
        const remaining = Math.max(0, minVisible - (performance.now() - shownAt))
        hideTimer = setTimeout(() => { hideTimer = null; visible.value = false }, remaining)
      }
    }
  }, { immediate: true })
  onBeforeUnmount(clear)
  return visible
}
```

`src/renderer/src/composables/useLatestRequest.ts` (≈35 lines) provides latest-wins plus abort. It is portable: Electron ignores the signal.

```ts
export function useLatestRequest() {
  let seq = 0
  let controller: AbortController | null = null
  async function run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<{ stale: boolean; value?: T }> {
    const id = ++seq
    controller?.abort()
    controller = new AbortController()
    try {
      const value = await fn(controller.signal)
      return id === seq ? { stale: false, value } : { stale: true }
    } catch (e) {
      if (id !== seq || (e instanceof DOMException && e.name === 'AbortError')) return { stale: true }
      throw e
    }
  }
  const isLatest = (id: number) => id === seq
  return { run, isLatest }
}
```

### 5.3 `useOffsetPagination.ts` changes (shared by case and cohort, so parity is automatic)

```ts
// state
const items = shallowRef<T[]>([])
const totalCount = ref(0)               // last KNOWN total, never null/NaN
const countPending = ref(false)
const loading = ref(false)              // raw in-flight flag
const hasLoadedOnce = ref(false)
const committedPage = ref(1)            // page whose rows are on screen
const { run } = useLatestRequest()
const pageCache = new LruMap<string, OffsetPageResult<T>>(6)   // values, not promises; keep on hit

const loadPage = async (opts: { preserveScroll?: boolean } = {}) => {
  const offset = (page.value - 1) * itemsPerPage.value
  const key = buildKey(offset)
  const hit = pageCache.get(key)
  if (hit) return commit(hit, opts)                // synchronous: no loading flag at all

  loading.value = true
  const needCount = cachedTotalCount === null
  countPending.value = needCount
  const res = await run((signal) => options.fetchPage({ offset, limit: itemsPerPage.value,
    sortBy: normalizeSortBy(sortBy.value), skipCount: !needCount, signal }))
  if (res.stale) return                             // newer request owns loading/items
  loading.value = false
  if (needCount && typeof res.value!.total_count === 'number') cachedTotalCount = res.value!.total_count
  pageCache.set(key, res.value!)
  commit(res.value!, opts)
}

function commit(r: OffsetPageResult<T>, { preserveScroll = false } = {}) {
  items.value = r.data
  totalCount.value = cachedTotalCount ?? totalCount.value   // keep last known; never assign null
  countPending.value = cachedTotalCount === null
  committedPage.value = page.value
  hasLoadedOnce.value = true
  options.onCommit?.({ preserveScroll })                     // table scrolls to top unless preserve
  scheduleIdle(() => { prefetch(+1); prefetch(-1) })
}
```

The error path keeps `items`/`totalCount` and sets `error` (the banner shows Retry). Remove `items.value = []; totalCount.value = 0` at `:199-200`. `resetState()` (case switch only) is the one place that clears rows, and it sets `hasLoadedOnce=false` so the first-load skeleton is shown.

Add `reloadCoalesced()`, which schedules one `invalidateAndReload` per microtask. Route **all** filter, column-filter and clear paths through it so a Clear click is exactly one request.

### 5.4 Shared table-state wrapper: `useTableLoadingState.ts`

```ts
export function useTableLoadingState(p: { loading: Ref<boolean>; hasLoadedOnce: Ref<boolean>;
  items: Ref<unknown[]>; totalCount: Ref<number>; countPending: Ref<boolean>; label: string }) {
  const busy = useDelayedFlag(p.loading, { delay: 150, minVisible: 300 })
  const isInitial = computed(() => !p.hasLoadedOnce.value && p.loading.value)
  const showSkeleton = useDelayedFlag(isInitial, { delay: 150, minVisible: 300 })
  const stale = computed(() => busy.value && p.hasLoadedOnce.value)
  const announcement = ref('')
  watchDebounced([p.items, p.totalCount], () => {
    if (p.loading.value) return
    announcement.value = p.totalCount.value === 0 ? `No ${p.label} match the current filters`
      : `Showing ${p.items.value.length.toLocaleString()} of ${p.totalCount.value.toLocaleString()} ${p.label}`
  }, { debounce: 400 })
  return { busy, showSkeleton, stale, announcement }
}
```

### 5.5 Template changes

`VariantTable.vue` and `cohort/CohortDataTable.vue` get identical changes. Put them in a shared `VariantDataTableShell` slot wrapper or in the shared CSS.

```vue
<div class="table-container" :aria-busy="busy ? 'true' : 'false'">
  <v-data-table-server
    …
    :loading="busy"                 <!-- delayed flag: Vuetify's header bar = our thin top bar -->
    :class="['variant-table--fixed', { 'is-stale': stale }]"
    :style="{ '--body-min-h': bodyMinHeight + 'px' }"
  >
    <!-- Only provide the loading slot during FIRST load: with a slot present Vuetify replaces rows on every load -->
    <template v-if="showSkeleton" #loading>
      <TableSkeletonRows :rows="skeletonRowCount" :columns="visibleHeaders" :row-height="36" />
    </template>
    <template #no-data> <VariantEmptyState @clear="emit('clear-filters')" /> </template>   <!-- cohort gets the same component -->
    <template #[`footer.prepend`]>
      <span v-if="countPending" class="text-medium-emphasis mr-2">≈</span>
    </template>
  </v-data-table-server>
  <span class="sr-only" role="status" aria-live="polite">{{ announcement }}</span>
</div>
```

Note on `:loading`: when `items` is non-empty and no `#loading` slot is provided, Vuetify keeps the rows and only adds the absolute-positioned header progress row (`VDataTableHeaders.js:293-304`). That is exactly the cohort's current behaviour. During first load `items` is empty, so the `v-if` slot shows the skeleton. `TableSkeletonRows` renders real `<tr><td>` cells per visible header (not one `colspan` cell), so column widths are identical to data rows.

Shared CSS (`data-table-shared.css`):

```css
.table-container .variant-table--fixed table { table-layout: fixed; }
.table-container .variant-table--fixed tbody { min-height: var(--body-min-h, 0); }
.table-container .v-data-table.is-stale tbody { opacity: .55; transition: opacity 120ms ease; }
.table-container .v-data-table tbody { transition: opacity 120ms ease; }
.table-container .v-data-table-progress .v-progress-linear { height: 2px !important; }
@media (prefers-reduced-motion: reduce) {
  .table-container .v-data-table tbody { transition: none; }
  .table-container .v-data-table-progress .v-progress-linear__indeterminate { animation: none; opacity: .6; }
}
```

For column widths, give **every** column a `width` in `variant-table/columns.ts` (`sv-columns.ts`, `cnv-columns.ts`, `str-columns.ts`) and the cohort column defs. Gene 110, Position 120, Chr 70, GT 60, Func 150, Consequence 110, Transcript 150, cDNA 170, AA Change 150, gnomAD 90, CADD 70, ClinVar 150, OMIM 100, links 64. The existing `max-width: 200px` + ellipsis stays. If fixed widths are unwanted for user-resized columns, use the fallback: after the first data commit, measure `th` widths once and pin them as `width` style until the header set or column preferences change (≈25 lines in `useTableScroll.ts`).

Use `tbody` `min-height` of `max(lastCommittedRows, 5) × 36 px` in the empty and skeleton states. That stops the 1800 → 180 px body collapse that currently clamps `scrollTop`.

**`ShortlistPanel.vue`:**
- Keep `ShortlistTable` mounted once `result` exists. Replace the `v-if="loading"` branch with `:class="{ 'is-stale': busy }"` plus the same delayed 2 px bar.
- Skeleton only when `result === null`, with 57 px rows and real columns.
- Footer stays.
- In `CaseView.vue:454-455`, switch `v-if` → `v-show` after first activation (`v-if="shortlistActivatedOnce" v-show="selectedVariantType === 'shortlist'"`). Tab returns are then instant and need no refetch. The existing annotation-changed subscription keeps it fresh.

**Filter toolbars (`SlimFilterToolbar.vue:124-151`):** replace `v-expand-transition` + `v-if` with an always-rendered `.applied-filters-bar` of fixed `min-height: 32px`, showing "No filters applied" muted text when the list is empty. Chip enter/leave uses opacity only (`<TransitionGroup name="fade">`).

**Debounce split:**
- `useFilterState.ts:109-115`: keep a 250 ms debounce for the search text only. Add `flushFilters()` for discrete actions: preset/ACMG chip toggles, Clear, drawer Apply, impact/AF chips.
- `useDebounce.ts`: add a `flush()` to the returned object.
- Mirror both in `CohortFilterBar.vue:465-470`, and add `searchTerm` to the watched sources (fixes R6).

**Clear-all (R5):**
- `useColumnFilters.ts:34-36`: `if (Object.keys(columnFilters.value).length) columnFilters.value = {}`.
- `FilterToolbar.vue:666-671` and `CohortTable.vue:514-524`: set all state, then call **one** `reloadCoalesced()`. Cancel pending debounces (`cancel()`) so the watchers don't re-fire.
- Move focus to the search input after Clear.

**Annotations (R10):**
- Start `loadAnnotationsBatch` and the next/prev prefetch in that order, with the prefetch deferred to idle.
- Optional (larger): piggy-back annotation flags onto `variants:query` so rows and icons arrive in one commit.
- Simpler interim: render annotation icons with a fixed-size placeholder so hydration changes only the glyph, never the layout.

**Render cost (R11):**
- Replace the per-cell `v-tooltip` in `VariantTable.vue:152-182` (func, transcript) with a single delegated tooltip or `title` attributes.
- Add `v-memo="[item.id, item.render.version]"` on the row template if moving to `#item` slots.
- Target: cache-hit page swap under 50 ms at d0 (currently 150–210 ms), under 200 ms at 4× CPU.

**Cohort multi-sort (R15):** pass the full `sortItems` array through `buildCohortQueryParams`, or set `:multi-sort="false"` on the cohort table so the UI doesn't promise priorities it can't honour.

### 5.6 Expected metrics after the change (targets for the perf E2E)

| Metric | Now (d300) | Target (d300) |
|---|---|---|
| Blank body on refetch | 400–690 ms (SNV), 470–560 ms (Shortlist) | **0 ms** (all surfaces) |
| Visual states per refetch | 3–5 | **2** (dimmed+bar → new). **1** when the response is under 150 ms |
| Column jitter | 50–134 px | **0 px** |
| CLS from filter chip bar | 0.01–0.06 | **0** |
| Stale response rendered | yes (case and cohort) | **never** (test in §6) |
| Requests per Clear | 4–5 | **1** (+1 idle prefetch) |
| Feedback after preset click | ~380 ms | **< 100 ms** (chip state + bar on response > 150 ms) |
| Footer anomalies | "0-NaN of NaN", ∅ on shortlist, footer ahead of rows | none |
| Back to previous page | full round trip | **instant** (LRU) |
| INP on page change (cpu4) | 190–730 ms | < 200 ms |

## 6. Prioritized fix list

| P | Fix | Files | Effort | Kills |
|---|---|---|---|---|
| **P0** | Latest-wins token (+ web abort) in `loadPage`. Never clear `loading` from a stale response. No `null` total. Keep rows on error. | `composables/useOffsetPagination.ts`, new `useLatestRequest.ts`, `web/client/api.ts` (signal passthrough) | S | R3, R4 (wrong data on screen, NaN footer) |
| **P0** | Cohort FTS search: watch `searchTerm` / emit from DSL FTS path | `cohort/CohortFilterBar.vue:465-470` | XS | R6 |
| **P1** | SWR on the case table: remove the unconditional `#loading` slot. Delayed bar + dim via `useDelayedFlag`/`useTableLoadingState`. First-load skeleton with real cells. Shared empty state on cohort. | `VariantTable.vue:16,223-226`, `cohort/CohortDataTable.vue:17`, new `TableSkeletonRows.vue`, `data-table-shared.css` | M | R1, R13, half of R14 |
| **P1** | One request per Clear (coalesced reload, no-op `clearAllColumnFilters`, cancel debounces) | `useColumnFilters.ts:34-36`, `useVariantData.ts:168-185`, `FilterToolbar.vue:666-671`, `CohortTable.vue:514-541` | S | R5 |
| **P1** | Fixed column widths (`table-layout: fixed` + widths for all columns) on case and cohort | `data-table-shared.css:119-125`, `variant-table/*columns.ts`, cohort column defs | S | R2 |
| **P1** | Reserved applied-filters row (no height animation) | `SlimFilterToolbar.vue:124-151` | XS | R7 |
| **P2** | Debounce split: 250 ms keystrokes, immediate flush for clicks (case and cohort) | `useDebounce.ts`, `useFilterState.ts:109-115`, `CohortFilterBar.vue:465-470` | S | R9 |
| **P2** | Explicit scroll policy + body min-height + footer `≈` while count pending | `useOffsetPagination.ts` (`onCommit`), `useTableScroll.ts`, both tables | S | R12 |
| **P2** | Shortlist SWR + keep panel mounted after first visit | `ShortlistPanel.vue:116-150`, `CaseView.vue:454-455` | S | R8 |
| **P2** | `aria-busy`, one polite status region per view, focus to search after Clear, reduced motion | both tables, `ShortlistPanel.vue`, `FilterToolbar.vue`, `CohortFilterBar.vue` | S | R14 |
| **P3** | LRU page cache (keep on hit) + prev/next idle prefetch after annotation batch | `useOffsetPagination.ts:86-125,152-172`, `useVariantData.ts:189-204` | S | R10, R11 (latency part) |
| **P3** | Row render cost (delegated tooltips, `v-memo`) | `VariantTable.vue:152-182`, `CohortDataTable.vue` cells | M | R11 (INP part) |
| **P3** | Cohort multi-sort honesty | `CohortTable.vue:364-365` | XS | R15 |

**Suggested PR split** (each ships case and cohort together, per `varlens-cohort-parity`):
1. P0 correctness (`useOffsetPagination` + cohort search) with unit tests:
   - "slow first response is ignored"
   - "total never NaN"
   - "error keeps rows"
   - "typing in cohort search triggers one query after debounce"
2. P1 SWR + layout (composables, templates, CSS, chip bar, Clear coalescing).
3. P2/P3 polish (debounce split, scroll policy, Shortlist, a11y, cache, render cost).

## 7. Verification plan

- **Unit (Vitest, happy-dom):**
  - `useOffsetPagination`: out-of-order resolution (resolve request 2 before 1, assert 1 is dropped and `loading` stays true until 2). Concurrent `invalidateAndReload` never yields a `null`/NaN total. LRU hit commits synchronously.
  - `useDelayedFlag` with fake timers: under 150 ms never visible; visible at least 300 ms.
  - `useColumnFilters.clearAll` on empty is a no-op.
  - `CohortFilterBar` emits `filter-change` on `searchTerm` change.
- **E2E:** port `table-loading/harness` into `tests/e2e/` as a perf spec on the frozen fixture. Gate:
  - `blankMs == 0` for every refetch
  - `colDeltaMax == 0`
  - `dupReqs == 0`
  - stale scenarios render the latest result
  - CLS < 0.01

  Run before/after with `scripts/perf/compare-phase1.mjs` per the AGENTS.md renderer-perf rule.
- **Manual:** throttle to "Slow 3G" in DevTools and page, sort and filter on both views. There should be no grey flash, no column movement and no footer flicker. Test with `prefers-reduced-motion` emulated.
