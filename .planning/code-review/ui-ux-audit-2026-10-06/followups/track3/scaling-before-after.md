# Track 3: responsive scaling, before and after

**Branch:** `feat/responsive-scaling`
**Implements:** audit [06-resolution-scaling.md](../../06-resolution-scaling.md) and roadmap PR 6 in [00-COMBINED-REPORT.md](../../00-COMBINED-REPORT.md) §9.

**How it was measured:**
- **Harness:** headless Chromium (Playwright 1.63), with `probe.mjs` in this folder.
- **Target:** a built web instance, using `VARLENS_WEB_BASE=/ npm run build:web` and `node out/web/server.cjs`.
- **Server settings:** port 8830, schema `web_dev_track3`. The schema is a clone of the 3-case dev schema, and every run used case LB26-0060 (SNV/Indel tab).
- **Accessibility scan:** axe-core 4 with the tags wcag2a, wcag2aa, wcag21a, wcag21aa and wcag22aa. The tables count only serious and critical violations.
- **Raw numbers:** `scaling-before-after.json`, kept next to this file in the worktree. The repo `.gitignore` excludes `.planning/code-review/**/*.json` and `*.png`, so the JSON and the screenshots are local evidence only. The tables below hold the numbers.

## Results

"Rows" means data rows that sit fully inside the table's own scroll viewport. These are the rows you can reach by scrolling the page or the content region. "Fold" means rows fully visible at scroll position 0.

| Viewport | Case rows before → after (fold) | Content scrollable | Panel at this width | axe serious/critical, case and cohort |
|---|---|---|---|---|
| 1366×768 | 10 → 10 | no (unchanged) | 400 px overlay, capped at 45vw (614) | 1/1 → **0/0** |
| 1280×720 | 8 → 8 | no | overlay | 1/1 → **0/0** |
| 1920×1080 | 19 → 19 | no | **docked**: pagination and toolbar uncovered (before: covered) | 1/1 → **0/0** |
| 2560×1440 | 25 → 25 | no | **docked** | 1/1 → **0/0** |
| 320×568 (reflow) | **0 → 4** (3 at fold) | **175 px, was 0** (the page could not scroll before) | full-width overlay | 1/2 → **0/0** |
| 200 % zoom (640×400 @2) | **0 → 5** (1 at fold) | **241 px, was 0** | full-width overlay | 1/2 → **0/0** |
| 200 % text (1280×800, root 200 %) | 6 → 10 (6 at fold) | 333 px | overlay | 0/1 → **0/0** |

The cohort view behaves the same way at every width:

| Viewport | Cohort rows before → after |
|---|---|
| 320×568 | 0 → 4 |
| 200 % zoom | 0 → 4 |
| 200 % text | 6 → 11 |
| 1366×768 | 10 → 10 |
| 1920×1080 | 18 → 18 |

Other results:
- **Horizontal page overflow:** none in any cell, before or after.
- **Clipped controls at 200 % text** (chips and buttons whose label overflows their box): 60 → 11. The 11 that remain are:
  - Buttons in closed, off-screen drawers.
  - The app-bar Case/Cohort toggle, because the app bar is 48 px tall in px.
  - The variant-type tabs.
- **Desktop at 100 %:** unchanged. The 1366×768 screenshot is identical in geometry, with the same rows and the same table header.

Targeted checks after the change:

| Check | Result |
|---|---|
| Sidebar at 1024×768 | Docked and open (`temporary: false`). Before this change, Vuetify's `lg` breakpoint made it temporary and closed below 1145 px. |
| Details panel at 1366 with a stored width of 800 px | Renders 614 px, which is the 45vw cap. Before, it rendered 800 px and covered 59 % of the screen. |
| Truncated cohort HGVS cell `n.2411+3252_2411+3253delinsTG` | The shared delegated tooltip shows the full value. It needs no per-cell `v-tooltip`. |
| Electron minimum window, 1024×640 | Case view shows 6 rows above the fold. The responsive column budget shows 11 columns, ClinVar included. |
| CLS for load, open case, then open and close the docked panel | 1920: 0.0045 unexpected. 1366: 0.010 unexpected. Docking itself is input-driven (`hadRecentInput`), so it adds 0 to CLS. |

## What changed

### Scrollable case and cohort views
These views fix the zero-row failures at 320 px and 200 % zoom (WCAG 1.4.10 and 1.4.4).
- **Height:** `.case-content` and `.cohort-content` now use `calc(100dvh - 48px - var(--v-layout-bottom))`. This replaces the hard-coded `100vh - 80px`.
- **Overflow:** the containers use `overflow-y: auto` instead of `hidden`.
- **Minimum table size:** the table keeps a rem minimum. In the case view that is 20rem on `.table-container`. In the cohort view the tab window gets 28rem, or 36rem below 600 px.
- **Chrome rows:** these rows no longer shrink.
- **Effect:** on desktop heights nothing overflows, so nothing changes there. On short or zoomed viewports the region scrolls, and the table keeps its sticky header and internal scroll.

### Details panel
- **Docking:** the panel docks (it is no longer `temporary`) at ≥ 1440 px, so `v-main` shrinks and nothing is covered.
- **Width cap:** below 1440 the panel stays an overlay, but its width is clamped to `min(800px, 45vw)`.
- **Code:** the logic is in `utils/responsive-layout.ts`.

### Column priority
The existing `COLUMN_PRIORITY` in `useResponsiveLayout` is now wired in. It sets the *default* visibility for both the case table and the cohort table.
- **Width budget:** `getMaxAutoVisibleColumns` maps width to a column budget:

  | Width | Columns shown by default |
  |---|---|
  | < 840 | 5 |
  | < 1145 | 10 |
  | < 1545 | 14 |
  | ≥ 1545 | unlimited |

- **Priority order:** link-out and extension columns have no priority entry, so they are hidden first.
- **User choices win:** an explicit visibility choice made in the Columns drawer always wins. Explicit columns neither use nor receive budget, so showing one column never silently hides another.
- **Columns drawer:** the drawer and the toggle use the effective visibility. `toggleColumnVisibility(key, currentlyVisible)` receives it.

### Truncated-cell tooltip
- **What:** `findTooltipTarget` in the existing app-wide delegated tooltip falls back to `findTruncatedCellText`. This covers any `.v-data-table td` whose content is clipped.
- **Cost:** the check only measures the hovered cell. It adds zero render cost per cell and does not touch the cell templates owned by track 2.

### rem typography
- **Control heights:** `scalable-controls.css` redeclares Vuetify's chip, button and tab height tokens in rem. The values are identical at a 16 px root, so the change is visible only under text-only resize.
- **Font sizes:** the 7 remaining px `font-size` declarations are converted to rem.

### Sidebar breakpoint
- **Drawer:** `mobile-breakpoint="md"` (840 px), replacing Vuetify's default `lg` (1145 px).
- **Auto-close:** the case-select auto-close follows `smAndDown`.

### Electron window
- **Change:** `minWidth: 1024, minHeight: 640`, through `APP_CONFIG.WINDOW_MIN_*`.
- **Scope:** only the window options changed.

### Axe fixes found along the way
These problems already existed on `main`.
- **Cohort header labels:** the select labels sat on `#f0f4f8` at 4.43:1. The fix gives the header a surface background.
- **Sidebar subtitle:** the selected case's subtitle was at 3.74:1. It now renders at full emphasis.
- **Preset chips:** when wrapped below 840 px, rows were too close for the WCAG 2.5.8 spacing rule. Rows now have an 8 px row gap.

## Deferred, with reasons

- **ClinVar off-screen at 1366 by default:** the cause is column *order* and the 7 link-out columns. The fix is to reorder columns or merge the link-outs into one "Links" column (audit §3.2). Both change product defaults and were not in this track's brief. At 1366 the new 14-column budget already removes the link-outs.
- **Column widths:** widths are in px (`variant-table/column-widths.ts`, owned by track 2). At 200 % text the headers still truncate ("P…", "G…").
- **App bar height:** 48 px in px. Track 4 owns the web shell. As a result, the Case/Cohort toggle still clips at 200 % text.
- **Pagination at 1366 with the panel open:** below 1440 the panel is still an overlay by design. A resize clamp plus docking at ≥ 1440 was the brief.
- **Out of scope:** the "Auto (fit)" page size, the Electron work-area-based first-launch size, and persisted window bounds. These are roadmap PR 6 extras that were not in this brief.

## Screenshots (local only, gitignored)

| | Before | After |
|---|---|---|
| 200 % zoom (640×400 @2) | `before-zoom200-case.png` | `after-zoom200-case-scrolled.png` |
| 320×568 | `before-320-case.png` | `after-320-case-scrolled.png` |
| 200 % text | `before-text200-case.png` | `after-text200-case.png` |

`probe.mjs` is the harness. It hard-codes the session scratchpad path for axe-core, so adjust `S` before you re-run it.
