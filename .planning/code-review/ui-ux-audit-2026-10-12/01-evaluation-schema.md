# 01 — VarLens UI/UX Evaluation Schema (0–100)

- **Date:** 2026-10-12 · **Type:** reusable scoring instrument (no app testing in this document).
- **Builds on:** `../ui-ux-audit-2026-10-06/01-standards-research.md` (here **R06**). Its rubric IDs (H1–H14, C1–C6, A1–A24, P1–P12) and sources [S1]–[S52] are reused, not restated. New sources are [N1]+ (Section 9).
- **Gaps filled here:** colour-vision-deficiency (CVD) safety, eye comfort and dark mode (APCA), spinner/skeleton flash rules, SUS/UMUX-Lite mapping, and genomic-viewer (lollipop, Mol*) criteria.
- **Use:** score every view in Section 4 on each applicable dimension in Section 2. Aggregate as in Section 5. Rate findings as in Section 3. Measure with the snippets in Section 7. Re-run each release with the same fixtures so scores can be compared.

---

## 1. Scoring rules

1. Each **sub-criterion** gets a band score of 0, 25, 50, 75 or 100 against the anchors of its dimension. Interpolation is not allowed, because it makes evaluators less consistent with each other.
2. The **dimension score** for a view is the mean of its applicable sub-criteria, after these caps are applied:
   - An open **P0** finding in that dimension and view caps the dimension at **25**.
   - An open **P1** finding caps it at **50**.
3. **Measured beats judged.** When a sub-criterion has a numeric threshold (Section 6), the measurement sets the band. Evaluator judgement may lower that band but never raise it.
4. **Both themes.** Score D3, D4 and D5 in light and dark theme and keep the *worse* result. Score every other dimension once, in the default theme.
5. **Evaluators.** Use at least 2 evaluators, with 3–5 preferred [S1]. Record each evaluator's scores separately and report the median. If two evaluators differ by more than 25 points on a dimension, discuss and re-score before aggregating.
6. **Fixtures.** Use the frozen perf fixture or the GIAB trio fixture, a 1440×900 window and a 1920×1080 window, and 100 % and 200 % zoom. Note the build SHA and the runtime (Electron or web).

## 2. Dimensions (14, total weight 100)

The **Method** keys are: `axe` = @axe-core/playwright with WCAG 2.2 A/AA tags. `LH` = Lighthouse 13 navigation and timespan flows. `CLS-obs` = snippet 7.1. `CVD-sim` = snippet 7.2. `CR-scan` = snippet 7.3. `APCA` = apca-w3 or apcacontrast.com. `HE` = manual heuristic walkthrough. `KLM` = keystroke-level count. `Task` = scripted task with a known answer.

### D1 Visual hierarchy & layout — weight 7
Sub-criteria: (a) one primary focal point per view, with case identity and result count read first. (b) The default column set fits 1440×900 without horizontal scroll, and at least 25 rows are visible in compact density at 1080p (R06 H8). (c) Spacing follows a consistent 4 px or 8 px grid. (d) Grouping is meaningful (Gerhardt-Powals #6). (e) There is no chartjunk or decorative chrome competing with the data.
Method: HE, screenshot overlay grid, DOM measurement of row count and scroll width.

| Band | Looks like |
|---|---|
| 100 | Instant orientation. Dense but calm. Every element is aligned to the grid. Key columns are visible. |
| 75 | One or two misalignments or a slightly competing element. Layout is still efficient. |
| 50 | Hierarchy is unclear in one area, for example a toolbar louder than the data. Some horizontal scroll at 1440 px. |
| 25 | There are several competing focal points, and the user has to search for case identity or the result count. |
| 0 | Layout is broken, overlapping or clipped at the reference sizes. |

### D2 Typography & readability — weight 6
Sub-criteria: (a) body text ≥ 14 px and dense table text ≥ 12 px, with line height ≥ 1.4 for prose. (b) `tabular-nums` for scores, AF, positions and counts. (c) HGVS and IDs in monospace or a distinct face, and never hyphenated or broken mid-token. (d) At most 3 sizes and 2 weights per view. (e) No clipping at 200 % zoom or with WCAG 1.4.12 spacing overrides. (f) Truncation uses an ellipsis and exposes the full value through a tooltip or the detail panel.
Method: computed-style scan, 1.4.12 bookmarklet, zoom test, HE.

| Band | Looks like |
|---|---|
| 100 | All of the above pass. Numbers align in columns, and long HGVS strings stay legible. |
| 75 | One minor scale inconsistency. No clipping. |
| 50 | Some 11 px text or numerals that jitter. Truncation sometimes has no way to see the full value. |
| 25 | Widespread small or low-weight text, or text that clips at 200 % zoom. |
| 0 | Critical values such as HGVS or genotype are unreadable or cut off. |

### D3 Colour & contrast — weight 7
Sub-criteria: (a) text contrast ≥ 4.5:1, or ≥ 3:1 for large text (WCAG 1.4.3). (b) non-text contrast ≥ 3:1 for input borders, focus rings, chip outlines, sort icons and chart marks (1.4.11). (c) APCA as an advisory check: body text \|Lc\| ≥ 75 (≥ 90 preferred for 12–14 px table text), large or bold text ≥ 60, non-text ≥ 45 [N3]. (d) No `surface-variant` backgrounds (AGENTS.md rule). (e) The semantic colour roles (error, warning, ACMG class, impact) are consistent across views.
Method: CR-scan in both themes, axe `color-contrast`, APCA spot checks on the table, chips and placeholders.

| Band | Looks like |
|---|---|
| 100 | 0 WCAG failures in both themes. APCA targets are met for table text. Semantic roles are uniform. |
| 75 | 0 failures for text. ≤ 2 non-text items between 2.5:1 and 3:1. |
| 50 | 1–5 text failures, for example placeholders or disabled-looking active text. |
| 25 | Systematic failures, such as a whole theme's secondary text. |
| 0 | Primary data is unreadable in one theme. |

### D4 Colour-blind safety — weight 6
Sub-criteria: (a) no information is carried by colour alone (WCAG 1.4.1). ACMG class, impact, zygosity, inheritance, quality flags, legends and lollipop marks all carry text, an icon or a shape as well. (b) Under Machado-2009 protan, deutan and tritan simulation at severity 1.0, each pair of categorical colours used together has a CIEDE2000 difference ΔE00 ≥ 10. Marks smaller than 6 px, such as chip dots and lollipop heads, need ΔE00 ≥ 15. These thresholds are an audit rule derived from Szafir's JND scaling for small marks [N1][N2]. (c) Under achromatopsia simulation, adjacent categories still differ by a luminance step (WCAG ratio ≥ 1.5:1) or by a non-colour cue. (d) Red/green is never the only contrast for pathogenic vs benign. (e) Sequential and diverging scales (heatmaps, burden) use CVD-safe maps such as viridis, cividis or Okabe-Ito categories [N4].
Method: CVD-sim screenshots per view, sampling categorical swatches and computing ΔE00 (colour.js / culori), HE for 1.4.1.

| Band | Looks like |
|---|---|
| 100 | Every coded element has redundant encoding, and all pairs meet ΔE thresholds under all 4 simulations. |
| 75 | Redundant encoding everywhere. 1–2 pairs fall below ΔE under one simulation, but text still disambiguates them. |
| 50 | One colour-only encoding on a secondary element, such as a legend or a chart series. |
| 25 | Colour-only encoding on a triage-relevant element, such as impact or a quality flag. |
| 0 | ACMG class or pathogenic vs benign can only be told apart by red/green. This is automatically P1 or worse. |

### D5 Eye comfort & dark mode — weight 5
Sub-criteria: (a) the dark background is not pure `#000`. Use about `#121212` to `#1e1e1e` with elevation shown by lighter surfaces [N5]. Body text is not pure `#fff` on near-black; use about 87 % white or an off-white to reduce halation. (b) Accent and semantic colours are desaturated or lightened in dark mode, and no fully saturated large fills are used [N5]. (c) In light mode the background is not pure white glare, for example the warm `surface` `#faf8f6`. (d) No theme flash at start-up or on toggle (R06 C1). Theme follows the OS preference and persists. (e) Motion respects `prefers-reduced-motion`, nothing flashes more than 3 times per second (2.3.1), and there is no gratuitous animation. (f) A 30-minute triage session does not produce strain: fixed light sources and no large high-contrast blocks alternating while scrolling.
Method: computed colours, filmstrip of start-up and toggle, `emulateMedia`, HE during a 30-minute scripted session.

| Band | Looks like |
|---|---|
| 100 | Both themes are calm, tuned to the guidance, have no flash and respect reduced motion. |
| 75 | Minor issues, such as one saturated accent in dark mode. |
| 50 | Pure black or pure white extremes, or a visible theme flash on start-up. |
| 25 | Dark mode feels like an afterthought: unreadable chips or glaring panels. |
| 0 | No dark mode, or one that is broken or unusable. |

### D6 Visual stability (layout shift & flicker) — weight 8
Sub-criteria: (a) CLS ≤ 0.02 per navigation, which is the project budget (CWV "good" is ≤ 0.1) [S26]. (b) Unexpected shift during filter, sort, page change and panel open/close is ≤ 0.02 *including* input-adjacent shifts. This is the same rule as `make perf-interaction-gates`. (c) No frame shows an empty table body, "No data" or a collapsed footer while a refetch is in flight (R06 C3). (d) Spinner rules: show a busy indicator only after about 300 ms, and once shown keep it visible for ≥ 400 ms. Use skeletons only on first load [N6][S3]. (e) Banners and alerts use reserved slots or overlays. (f) Chip rows do not wrap and push the table down.
Method: CLS-obs (shifts with source nodes), Playwright screenshots at +50, +150 and +300 ms, LH timespan.

| Band | Looks like |
|---|---|
| 100 | CLS ≤ 0.005. No flicker frames. Spinners never flash. |
| 75 | CLS ≤ 0.02. One brief spinner flash under 300 ms. |
| 50 | CLS 0.02–0.1, or one empty-body frame on refetch. |
| 25 | CLS 0.1–0.25, or repeated content jumps that make the user lose their row. |
| 0 | CLS > 0.25, or the user clicks the wrong row because of a shift (P1). |

### D7 Responsiveness & perceived performance — weight 8
Sub-criteria: (a) INP < 200 ms (median of 3) for filter apply, sort, row select and panel open. Stretch target: ≤ 100 ms for select and panel open. (b) Web build Lighthouse desktop Performance ≥ 0.95. (c) LCP ≤ 1.2 s to the table shell on desktop. (d) Visible feedback ≤ 100 ms after every input. (e) A query on a case with ≤ 100k variants returns in ≤ 400 ms (Doherty threshold). (f) Import and export show determinate progress beyond 10 s. (g) No long animation frame over 50 ms in the filter path.
Method: LH (n=3 median), web-vitals attribution, LoAF observer, stopwatch on the import fixture.

| Band | Looks like |
|---|---|
| 100 | All targets met with margin, and it feels instant. |
| 75 | All hard gates met. One stretch target missed. |
| 50 | INP 200–500 ms on one interaction, or LH Performance 0.80–0.94. |
| 25 | Several interactions over 500 ms, or blocking UI during import. |
| 0 | Freezes for more than 2 s, or the app becomes unresponsive. |

### D8 Accessibility (WCAG 2.2 AA, keyboard, screen reader) — weight 10
Sub-criteria: R06 A1–A24, condensed. (a) axe reports 0 serious or critical issues per route and state, including open dialogs, menus and drawers. (b) Every core task can be done by keyboard, with no traps, including the Mol* canvas. (c) Focus is visible and not obscured (2.4.7 / 2.4.11), and returns to its origin after a dialog or panel closes. (d) Targets ≥ 24×24 px (2.5.8), with an audit target of 32 px for primary row actions. (e) Status messages for result count, save and import are announced (4.1.3). (f) Grid or table, combobox, dialog and tab ARIA patterns are correct (APG). (g) Single-key shortcuts can be disabled or only work when focused (2.1.4). (h) Dragging has an alternative (2.5.7).
Method: axe and the IBM checker, Accessibility Insights assessment, NVDA or Orca spot checks.

| Band | Looks like |
|---|---|
| 100 | 0 axe violations. Full keyboard and screen-reader path through the triage loop. |
| 75 | 0 serious or critical. Minor manual gaps, for example one tooltip without Esc. |
| 50 | 1–3 serious issues, or one core task needs a mouse. |
| 25 | Many serious issues. Dialogs or the grid are inaccessible. |
| 0 | Keyboard trap or critical violations on core views. |

### D9 Information architecture & navigation — weight 6
Sub-criteria: (a) at most 2 clicks from home to any case variant table. Every view has a clear "where am I" (case ID and sample always visible, R06 H14). (b) Back navigation preserves page, sort, filters and scroll (R06 H3/C5). (c) Labels match user mental models (case, cohort, gene burden). (d) Deep links or routes exist for case, variant and cohort. (e) Settings, import and export are discoverable in one obvious place.
Method: tree test or first-click task, HE, route and state round-trip test.

| Band | Looks like |
|---|---|
| 100 | Users always know where they are. State survives every round trip. |
| 75 | One state loss on a rare path. |
| 50 | Table state is lost on back navigation, or one feature is buried. |
| 25 | Users get lost between case, cohort and settings. Identity is not visible. |
| 0 | A user can act on the wrong case without noticing (P0). |

### D10 Interaction efficiency (clinical triage loop) — weight 9
Sub-criteria: (a) the loop *open variant → inspect → classify → next* takes ≤ 3 interactions per variant and works fully by keyboard (R06 H7). (b) Quick-filter chips, presets and the DSL search reach a typical clinical filter in ≤ 5 actions. DSL errors are explained inline. (c) Column show, hide and reorder persist. (d) Multi-select and bulk actions exist where cohort or export needs them. (e) The detail panel opens without losing the table, and next/previous works within the panel.
Method: KLM per scripted task, Task timing (median, n ≥ 3), SEQ ≥ 5.5 per task [S38].

| Band | Looks like |
|---|---|
| 100 | ≤ 3 interactions per loop step, all keyboard, SEQ ≥ 6. |
| 75 | 4–5 interactions, or one step needs the mouse. |
| 50 | 6–8 interactions, or a context switch such as a dialog per variant. |
| 25 | More than 8 interactions or repeated re-filtering. SEQ ≤ 4. |
| 0 | The core loop cannot be completed without workarounds. |

### D11 Feedback, status & error recovery — weight 7
Sub-criteria: (a) every async action shows pressed or busy state within 100 ms and a completion state (R06 H1/H12). (b) The active-filter state and result count are always visible. (c) Errors say what happened, why, and what to do next. No raw `SerializableError` or stack text is shown. (d) Destructive actions have a confirm or undo. Classification edits have history. (e) Empty, loading and error states are distinct and occupy the same reserved height. (f) Import failures identify the file, line or sample and are recoverable without restarting.
Method: fault injection (bad VCF, IPC reject, DB locked), HE.

| Band | Looks like |
|---|---|
| 100 | Every state is explicit and human-readable, and recovery is always possible. |
| 75 | One generic error message. |
| 50 | Silent failures or raw error text on a secondary path. |
| 25 | Import or save fails silently, or there is no undo for destructive actions. |
| 0 | Data loss without a warning (P0). |

### D12 Consistency (including case ↔ cohort parity) — weight 6
Sub-criteria: (a) no differences between case and cohort views in filter, sort, search, columns or column metadata (project rule). (b) The same icon, colour and chip semantics everywhere. (c) The same component for the same job, for example one confirm dialog and one table density. (d) Platform conventions: Esc closes, Enter submits, Ctrl/Cmd shortcuts work. (e) Copy is consistent in terminology, casing and units.
Method: side-by-side parity matrix with the varlens-cohort-parity checklist, UI inventory, HE.

| Band | Looks like |
|---|---|
| 100 | Parity matrix fully green, with a single design vocabulary. |
| 75 | 1–2 cosmetic differences. |
| 50 | One functional parity gap, such as a filter only available in the case view. |
| 25 | Several gaps or conflicting semantics, such as the same colour meaning different things. |
| 0 | Same control, opposite behaviour. |

### D13 Domain fit & data integrity — weight 10
Sub-criteria: (a) ACMG/AMP criteria (PVS1…BP7) and classes (P/LP/VUS/LB/B) are named and combined correctly. (b) HGVS c./p./g. is shown with transcript and genome build next to it (R06 C6). (c) `consequence` is shown as IMPACT and `func` as the SO term, never swapped. (d) Zygosity, genotype and inheritance are unambiguous. (e) Filters never hide variants silently: the excluded count and active-filter chips are visible, and null or missing values are handled explicitly. (f) Numbers keep their precision and units (AF in scientific notation where needed, CADD/REVEL/SpliceAI with cut-off context). (g) Cohort and burden views state their denominators and test assumptions (R06 H13). (h) Lollipop and gene schema views show correct residue scale, domains, transcript ID and per-position stacking [N7][N8]. The 3D viewer maps a variant to the correct residue or chain and states when no structure or AlphaFold model covers it [N9].
Method: Task with known-answer fixtures (planted P/LP variant, multi-allelic, missing AF), cross-check against source VCF or JSON, expert HE.

| Band | Looks like |
|---|---|
| 100 | Every known-answer task is correct. Terminology is exact. No silent exclusion. |
| 75 | A minor labelling imprecision with no risk of a wrong decision. |
| 50 | An ambiguous display that an expert resolves but a trainee might misread. |
| 25 | A misleading display, such as the wrong transcript as default without a cue, or an unlabelled filter exclusion. |
| 0 | Wrong data shown, or a planted pathogenic variant is missed (P0). |

### D14 Help & learnability — weight 5
Sub-criteria: (a) inline explanations for every ACMG criterion, predictor column and DSL operator (R06 H10). (b) The FAQ and docs are reachable from the relevant context. (c) A keyboard-shortcut sheet is reachable with `?` or a menu entry, and matches the actual bindings. (d) Empty states teach the next step, for example "Import a VCF". (e) The About page states version, licences and intended use (research use, not diagnostic), as required by R06 C5.
Method: HE, a first-use task with a novice persona, shortcut sheet compared against the keymap source.

| Band | Looks like |
|---|---|
| 100 | Self-explanatory. Contextual help everywhere. Intended use is explicit. |
| 75 | Help exists but one area lacks it. |
| 50 | Help exists only in external docs, or the shortcut sheet is stale. |
| 25 | Little help. Jargon is unexplained. |
| 0 | No help, and intended use is unstated. |

## 3. Severity scale for findings

| Level | Nielsen | Definition | Fix by |
|---|---|---|---|
| **P0** | 4 Catastrophe | Can cause a wrong classification, a missed or hidden pathogenic variant, an action on the wrong case or sample, or data loss *silently* (the user cannot notice). Also a keyboard trap or a crash on a core path. | Before the next release |
| **P1** | 3 Major | Any finding that **could** contribute to a wrong classification or a missed variant, even if a careful user could notice it (the floor rule from R06). Also a core-task blocker for some users (an a11y blocker), or CLS or INP outside "good" on a core interaction. | Current milestone |
| **P2** | 2 Minor | Slows the user down or causes confusion with an easy workaround. Secondary-view a11y issues. | Backlog, next 2 milestones |
| **P3** | 1 Cosmetic | Polish only: alignment, a wording nit, a single minor inconsistency. | Opportunistic |

Rate each finding on frequency × impact × persistence [S1]. Every finding records: ID, view, dimension, P-level, evidence (screenshot, metric or axe rule), repro steps and a suggested fix.

## 4. Per-view scorecard template

Copy this table for each audit run. `—` means the dimension is not applicable to that view. View weights `vw` reflect clinical importance and time spent in the view.

| View | vw | D1 7 | D2 6 | D3 7 | D4 6 | D5 5 | D6 8 | D7 8 | D8 10 | D9 6 | D10 9 | D11 7 | D12 6 | D13 10 | D14 5 | View score |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Login | 3 | | | | — | | | | | — | — | | | — | | |
| Home / case list | 8 | | | | | | | | | | | | | | | |
| Case variant table (filters, chips, DSL, columns drawer) | 22 | | | | | | | | | | | | | | | |
| Variant details panel (transcripts, ACMG, HPO, links) | 16 | | | | | | | | | | | | | | | |
| Gene schema / lollipop | 6 | | | | | | | | | | — | | | | | |
| 3D structure (pdbe-molstar) | 4 | | | | | | | | | | — | | | | | |
| Cohort view + gene burden | 13 | | | | | | | | | | | | | | | |
| Case metadata / annotations | 5 | | | | | | | | | | | | | | | |
| Import (VCF/JSON) | 9 | | | | — | | | | | | | | | | | |
| Export | 5 | | | | — | | | | | | | | | | | |
| Settings (incl. theme toggle) | 4 | | | | — | | | | | | — | | | — | | |
| About / FAQ | 2 | | | | — | | — | | | | — | — | | — | | |
| Keyboard shortcuts (sheet + global bindings) | 3 | | | | — | — | — | — | | | | — | | — | | |
| **Weighted** | 100 | | | | | | | | | | | | | | | **Overall** |

Theme is scored inside every view through D3, D4 and D5 (worse of light and dark), not as a separate row.

## 5. Aggregation

1. **View score:** `V_v = Σ_d (w_d · s_{v,d}) / Σ_d w_d`, summing over the dimensions applicable to view *v*.
2. **Raw overall:** `O_raw = Σ_v (vw_v · V_v) / Σ_v vw_v`.
3. **Gates**, applied after aggregation. These stop a polished UI from hiding a safety problem.
   - Any open **P0** caps the overall score at **49**.
   - **D13** below 50 on the case table or the details panel caps the overall score at **59**.
   - **D8** below 50 on any core view (table, details, cohort, import) caps the overall score at **69**.
   - Any measured hard threshold failing in CI (CLS ≤ 0.02, INP < 200 ms, axe 0 serious/critical, LH Performance ≥ 0.95) caps the overall score at **79**.
   `O = min(O_raw, applicable caps)`. Always report both `O_raw` and `O`, plus the binding cap.
4. **Bands for reporting:** 90–100 excellent · 80–89 good · 70–79 acceptable · 50–69 needs work · < 50 unacceptable.
5. **Dimension profile:** also report each dimension's score across views, `D_d = Σ_v vw_v·s_{v,d} / Σ_v vw_v` over applicable views. Track the profile per release.
6. **Optional calibration with users** (not part of O): expert-estimated SUS per persona [S36], or UMUX-Lite from real users converted with `SUS ≈ 0.65 × UMUX-Lite(0–100) + 22.9` [S37]. SUS 68 ≈ average and ≥ 80.3 ≈ grade A. If O and SUS-equivalent differ by more than 15 points, re-examine the heuristic scores.

## 6. Numeric thresholds

| Metric | Pass line (this audit) | Reference / note |
|---|---|---|
| Text contrast (WCAG 1.4.3) | ≥ 4.5:1. Large text (≥ 24 px, or ≥ 18.66 px bold) ≥ 3:1 | [S20] |
| Enhanced text contrast (1.4.6, advisory) | ≥ 7:1 for dense 12–13 px table text | AAA, a stretch target for long sessions |
| Non-text contrast (1.4.11) | ≥ 3:1 for UI component boundaries, focus rings, states and chart marks | [S20] |
| APCA (advisory) | \|Lc\| ≥ 75 body, ≥ 90 for 12–14 px dense text, ≥ 60 large or bold, ≥ 45 non-text and icons, ≥ 30 for disabled or placeholder text, which must not carry data | [N3]. APCA is a WCAG 3 candidate and not normative. |
| CVD categorical ΔE00 | ≥ 10 per pair under protan, deutan and tritan simulation (Machado 2009, severity 1.0). ≥ 15 for marks under 6 px. ≥ 20 for normal vision. | Audit rule derived from [N1][N2] |
| Achromatopsia separation | Adjacent categories differ by ≥ 1.5:1 luminance ratio, or have a text or shape cue | Audit rule |
| Dark theme | Background luminance not `#000` (about `#121212`–`#1e1e1e`). Text ≤ about 87 % white. Accents desaturated. | [N5] |
| CLS per navigation | ≤ 0.02 (CWV good ≤ 0.1, poor > 0.25) | [S26]. Project gate |
| CLS per interaction | ≤ 0.02, including input-adjacent shifts. Target 0. | `make perf-interaction-gates` |
| INP | < 200 ms per interaction (median of 3). Stretch ≤ 100 ms for select and panel open. | [S26][S27] |
| LCP (desktop, web build) | ≤ 1.2 s. CWV good ≤ 2.5 s. | [S28] |
| TBT on load | ≤ 100 ms desktop | [S28] |
| Long animation frame | No frame over 50 ms in the filter, sort or select path | [S33] |
| Lighthouse (web, desktop, median of 3) | Performance ≥ 0.95. Accessibility = 1. Best Practices = 1. SEO not applicable. | `make ui-gates` |
| axe | 0 serious or critical per route and state, in light and dark theme | `make ui-gates` |
| Spinner delay / minimum display | Show after ≥ 300 ms. Once shown, keep it visible for ≥ 400 ms. Skeletons on first load only. | [N6][S3] |
| Feedback latency | ≤ 100 ms visible response. Query ≤ 400 ms for a case with ≤ 100k variants. Determinate progress for anything over 10 s. | [S34][S35] |
| Target size (2.5.8) | ≥ 24×24 CSS px or spacing equivalent. Audit target 32 px for primary row actions. | [S20] |
| Flash (2.3.1) | ≤ 3 flashes per second | [S20] |
| Triage loop | ≤ 3 interactions per variant, fully keyboard. SEQ ≥ 5.5. | R06 H7, [S38] |
| Table density | ≥ 25 rows visible in compact density at 1080p. Default columns fit at 1440 px. | R06 H8 |

## 7. Measurement snippets (paste into DevTools, or `page.evaluate` in Playwright `_electron`)

### 7.1 Layout-shift observer with source nodes and session windows

```js
(() => {
  const shifts = [];
  const desc = (n) => !n ? '(gone)' : n.nodeType !== 1 ? n.nodeName :
    n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') +
    (n.classList.length ? '.' + [...n.classList].slice(0, 3).join('.') : '');
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      shifts.push({ t: Math.round(e.startTime), value: e.value, hadRecentInput: e.hadRecentInput,
        sources: (e.sources || []).map((s) => ({ node: desc(s.node), prev: s.previousRect?.toJSON(), curr: s.currentRect?.toJSON() })) });
    }
  }).observe({ type: 'layout-shift', buffered: true });
  // CWV CLS = largest session window (gap < 1 s, span ≤ 5 s) of shifts without recent input.
  const cls = (includeInput = false) => {
    let max = 0, cur = 0, start = 0, last = -Infinity;
    for (const s of shifts) {
      if (!includeInput && s.hadRecentInput) continue;
      if (s.t - last > 1000 || s.t - start > 5000) { cur = 0; start = s.t; }
      cur += s.value; last = s.t; max = Math.max(max, cur);
    }
    return +max.toFixed(4);
  };
  window.__cls = {
    shifts, cls,
    mark: () => shifts.length, // call before an interaction, then pass the result to since()
    since: (i) => ({ total: +shifts.slice(i).reduce((a, s) => a + s.value, 0).toFixed(4), entries: shifts.slice(i) }),
    report: () => { console.table(shifts.map((s) => ({ t: s.t, v: s.value.toFixed(4), input: s.hadRecentInput, nodes: s.sources.map((x) => x.node).join(' | ') }))); return { cls: cls(), clsInclInput: cls(true) }; },
  };
})();
```

### 7.2 CVD simulation injector (Machado 2009, severity 1.0, applied in linear RGB)

```js
(() => {
  const M = {
    protanopia:   '0.152286 1.052583 -0.204868 0 0  0.114503 0.786281 0.099216 0 0  -0.003882 -0.048116 1.051998 0 0  0 0 0 1 0',
    deuteranopia: '0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0',
    tritanopia:   '1.255528 -0.076749 -0.178779 0 0  -0.078411 0.930809 0.147602 0 0  0.004733 0.691367 0.303900 0 0  0 0 0 1 0',
    achromatopsia:'0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0',
  };
  const NS = 'http://www.w3.org/2000/svg';
  let svg = document.getElementById('__cvd');
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.id = '__cvd'; svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    for (const [k, v] of Object.entries(M)) {
      const f = document.createElementNS(NS, 'filter'); f.id = '__cvd-' + k;
      f.setAttribute('color-interpolation-filters', 'linearRGB'); // Machado matrices are defined in linear RGB
      const m = document.createElementNS(NS, 'feColorMatrix'); m.setAttribute('type', 'matrix'); m.setAttribute('values', v);
      f.appendChild(m); svg.appendChild(f);
    }
    document.body.appendChild(svg);
  }
  // Usage: __cvd('deuteranopia') · __cvd(null) to reset. Covers teleported Vuetify overlays (inside <html>).
  window.__cvd = (type) => { document.documentElement.style.filter = type ? `url(#__cvd-${type})` : ''; };
})();
```

Note: a filter on `<html>` creates a containing block, so `position: fixed` overlays may shift slightly. That is fine for screenshots, but do not measure CLS while a filter is applied. WebGL canvases (Mol*) are filtered too. Take one screenshot per type and view, then sample the categorical swatches and compute ΔE00.

### 7.3 WCAG contrast sampler (visible text, effective background found by walking ancestors)

```js
(() => {
  const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { // normalises any CSS colour (rgb, oklch, color()) through the canvas
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255];
  };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); // source-over compositing
    return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const effectiveBg = (el) => {
    const layers = []; let manual = false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') manual = true; // gradients and images need manual review
      const c = rgba(cs.backgroundColor); if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let bg = [255, 255, 255, 1]; // canvas fallback
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return { bg, manual };
  };
  const out = []; const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (t) => t.data.trim() ? 1 : 2 });
  for (let t; (t = w.nextNode());) {
    const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('[aria-hidden="true"]')) continue;
    const { bg, manual } = effectiveBg(el);
    const fg = over(rgba(cs.color), bg); // composite translucent text onto its background
    const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
    const cr = ratio(fg, bg);
    if (cr < need) out.push({ ratio: +cr.toFixed(2), need, px, text: t.data.trim().slice(0, 40), el, manual,
      fg: `rgb(${fg.slice(0, 3).map(Math.round)})`, bg: `rgb(${bg.slice(0, 3).map(Math.round)})` });
  }
  out.sort((a, b) => a.ratio - b.ratio);
  console.table(out.map(({ el, ...o }) => o));
  return out;
})();
```

Limits: this script ignores ancestor `opacity`, `mix-blend-mode`, text over images (flagged `manual`), and positioned elements that are not DOM ancestors of the text. Disabled controls are exempt under WCAG, so check flagged items against that. Cross-check with axe `color-contrast`. Run it in both themes and with menus, dialogs and the details panel open.

## 8. Viewer-specific criteria (apply within D1, D4, D8, D13)

- **Lollipop / gene schema:** the axis is in amino-acid residues, with the transcript ID and protein length labelled. Domains are labelled with text, and colour alone is not used [N7]. Stacked marks at one position stay countable, with marker size or count proportional and stated. The case variant is visually distinct from cohort or ClinVar background by shape or outline as well as colour. Hover and focus show HGVS p. and the consequence (SO term). Every mark can be reached by keyboard and is listed in an equivalent table [N8]. Overlapping labels do not occlude each other.
- **3D structure (Mol*):** the structure source and coverage are stated (PDB ID or AlphaFold, residue range, pLDDT for predicted models). The variant residue is highlighted and focused on load. If the variant is outside the model, an explicit message says so rather than showing a silent default view. The canvas is not a keyboard trap, and Esc or Tab leaves it. Controls have accessible names. Loading is lazy, with a reserved container of fixed aspect ratio (CLS 0). The default representation is readable in both themes. Mol* has a known steep learning curve [N9], so offer 2–3 preset views instead of the full Mol* UI.
- **Burden / cohort charts:** denominators (n cases, n carriers), the test used and the multiple-testing correction are shown. Sequential scales use CVD-safe colour maps. No dual axes or truncated bars without a marker.

## 9. Sources

R06 sources [S1]–[S52] apply as listed in `../ui-ux-audit-2026-10-06/01-standards-research.md` §D. New sources:

| # | Source | URL | Used for |
|---|---|---|---|
| N1 | Machado, Oliveira & Fernandes (2009) "A Physiologically-based Model for Simulation of Color Vision Deficiency", IEEE TVCG 15(6):1291–1298; matrices and supplement | https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html · https://doi.org/10.1109/TVCG.2009.113 · https://colour.readthedocs.io/en/latest/colour.blindness.html | Snippet 7.2 matrices, severity-graded simulation |
| N2 | Szafir, Stone & Gleicher (2014) "Adapting Color Difference for Design"; Szafir (2018) "Modeling Color Difference for Visualization Design", IEEE TVCG 24(1) | https://www.tableau.com/en-gb/research/publications/adapting-color-difference-design · https://cmci.colorado.edu/visualab/VisColors/17-VIS-ModelingColorDifference.pdf | Basis for the ΔE thresholds per mark size (web JND ≈ 4–6 ΔE units; small marks need more). The thresholds in §6 are derived from this, not quoted. |
| N3 | APCA: Myndex apca-introduction; APCA Lc table (bronze-level draft) | https://github.com/Myndex/apca-introduction · https://gihyo.jp/article/2023/08/apca-02 · https://apcacontrast.com/ | Lc 90/75/60/45/30 targets. Not normative, and sources differ, so verify before citing externally. |
| N4 | Okabe & Ito (2008) Color Universal Design; viridis/cividis (Nuñez et al. 2018, PLoS ONE) | https://jfly.uni-koeln.de/color/ · https://doi.org/10.1371/journal.pone.0199239 | CVD-safe categorical and sequential palettes |
| N5 | Material Design 2 — Dark theme | https://m2.material.io/design/color/dark-theme | #121212 surface, elevation by lightness, desaturated accents, 87 % text emphasis |
| N6 | Delayed-spinner conventions: Learning Equality design system (300 ms delay, ≥ 400 ms minimum); Primer Spinner `delay`; Epic React "pending flash" / spin-delay; uxdesign.cc | https://design-system.learningequality.org/loaders · https://primer.style/react/Spinner · https://suspense.epicreact.dev/02/03 · https://uxdesign.cc/should-you-delay-showing-the-user-that-something-is-loading-dd43077d5fc1 | Spinner delay and minimum display rule. These are conventions, not a formal standard. |
| N7 | Jay & Brouwer (2016) "Lollipops in the Clinic: Information Dense Mutation Plots for Precision Medicine", PLoS ONE | https://pmc.ncbi.nlm.nih.gov/articles/PMC4973895/ | Clinical lollipop design (single-sample focus, concise domain display) |
| N8 | GDC ProteinPaint lollipop user guide | https://docs.gdc.cancer.gov/Data_Portal/Users_Guide/proteinpaint_lollipop/ | Reference conventions: discs coloured by class and sized by count, list view alternative |
| N9 | Sehnal et al. (2021) "Mol* Viewer", NAR 49(W1), doi:10.1093/nar/gkab314; MolViewSpec (2025) | https://doi.org/10.1093/nar/gkab314 · https://pmc.ncbi.nlm.nih.gov/articles/PMC12230705/ | Viewer capabilities. Steep learning curve, so use presets. |
| N10 | W3C WCAG 2.2 Understanding 1.4.1 Use of Color, 1.4.11 Non-text Contrast, 2.3.1 Three Flashes | https://www.w3.org/WAI/WCAG22/Understanding/use-of-color · https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast · https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold | D4, D5 criteria |

**Confidence notes:** the CVD ΔE00 pass lines (10, 15, 20) and the achromatopsia rule (1.5:1) are audit-defined rules derived from JND research, not published standards. Formal usability evaluations of lollipop and Mol* viewers are essentially absent from the literature, so §8 is built from tool conventions plus WCAG. APCA values vary between secondary sources.
