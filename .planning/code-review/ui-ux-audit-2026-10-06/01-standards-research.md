# 01 — Standards & Tooling Research for the VarLens UI/UX Audit

- **Date:** 2026-10-06
- **Type:** Desk research only. The app was not tested for this document.
- **Scope:** The standards, frameworks, metrics and tools for evaluating a complex, data-dense professional web tool (VarLens: Vue 3 + Vuetify 4 SPA in Electron 43, with an optional web build). Users are clinical geneticists and researchers working in large server-side variant tables, filter toolbars, side detail panels, cohort views, ACMG classification and HPO matching.
- **Use:** Section A is the scoring rubric for later audit documents (02+). Section B lists the tools. Section C is the Vue/Vuetify anti-flicker checklist. Section D lists the sources.

> Conventions: **[S#]** refers to the source list in Section D. "Derived" means computed here from a published formula, not quoted from a source. Thresholds are "pass" lines for this audit. Some are stricter than the source minimum, and those cases are marked.

---

## 0. Key facts that changed in 2025–2026 (check before relying on older material)

| Topic | Current state (as of 2026-10-06) | Source |
|---|---|---|
| Lighthouse | **v13** (Oct 2025; Chrome 143+). Legacy perf audits were replaced by *insight* audits (e.g. `layout-shifts` → `cls-culprits-insight`, `render-blocking-resources` → `render-blocking-insight`, `font-display` → `font-display-insight`). Removed: `first-meaningful-paint`, `font-size` (SEO), `no-document-write`, `offscreen-images`, `preload-fonts`, `third-party-facades`, `uses-passive-event-listeners`. **Perf scoring is unchanged** (still the v10 weights). Node ≥ 22.19. | [S30][S31] |
| Core Web Vitals | LCP / INP / CLS. Thresholds are unchanged since INP replaced FID (2024-03-12). There is discussion of an INP threshold of 150 ms, but it has not been adopted. | [S26][S27] |
| WCAG | **2.2** is the current Recommendation (W3C, Oct 2023; ISO/IEC 40500:2025). **WCAG 3.0** is still a Working Draft (latest WD 2026-03-03). The Candidate Recommendation is projected for about Q4 2027 and the Recommendation for ≥ 2028. It is not a compliance target. | [S20][S22] |
| EN 301 549 | **V4.1.1 published 2026-09-02**. It aligns with WCAG 2.2 A/AA. Citation in the EU Official Journal (presumption of conformity under the EAA) is expected around end of Nov to mid Dec 2026. Until then V3.2.1 (WCAG 2.1) is the harmonised standard. | [S23][S24] |
| European Accessibility Act | Enforceable since **2025-06-28**. Market-surveillance inspections are ramping up in 2026. It mainly covers consumer-facing products and services. A B2B clinical/research desktop tool is likely *out of direct scope*, but public-sector and hospital procurement often requires EN 301 549 anyway. | [S24][S25] |
| FDA HFE guidance | *Applying Human Factors and Usability Engineering to Medical Devices* was **revised 2026-08-03**, its first revision since 2016. It is a harmonisation release: definitions align with IEC 62366-1 and QMSR/ISO 13485, and the HF report template (old App. A) moved into the separate *Content of HF Information in Marketing Submissions* guidance (finalised 2026). | [S13][S14] |
| FDA AI-enabled DSF | Draft guidance (Jan 2025) with explicit HF expectations for AI outputs. It is relevant only if VarLens adds ML-based prioritisation. | [S15] |
| MDCG 2019-11 | **Rev.1 (2025)**: expanded qualification decision trees, decision-support borderline cases, and modular MDSW. Software that interprets genetic test results for an individual patient is typically **IVD MDSW (IVDR)**, not MDR. | [S16][S17] |

---

## A. Evaluation rubric (score VarLens against this)

Each row gets a score of 0–4 in later documents. 4 means the pass threshold is met with margin, 3 means met, 2 means partially met or a minor gap, 1 means a major gap, and 0 means absent or catastrophic. Nielsen severity (0–4) applies to individual findings, not to rows.

### A1. Usability heuristics and interaction principles

| # | Dimension | Standard source | Measurable criterion | Pass threshold |
|---|---|---|---|---|
| H1 | Visibility of system status | Nielsen #1 [S1]; ISO 9241-110 "self-descriptiveness" [S4] | Every async action (query, import, export, classification save) gives feedback within 100 ms (pressed/busy state) and shows progress if it takes > 1 s. The result count and active-filter state are always visible. | 100 % of the audited async actions have feedback. Result count and active-filter chips are visible without scrolling. |
| H2 | Match with domain language | Nielsen #2; Gerhardt-Powals #5 (names related to function) [S7] | Terms match ACMG/AMP (PVS1…BP7, P/LP/VUS/LB/B), HGVS, HPO and SO vocabulary. `consequence` (IMPACT) is not confused with `func` (SO term) in the UI. | 0 non-standard or ambiguous clinical labels in the audited screens |
| H3 | User control & freedom / reversibility | Nielsen #3; Shneiderman #6 [S6]; ISO 9241-110 "controllability" | Filters can be cleared individually and all at once. Classification edits can be undone or have history. Dialogs close with Esc. Back navigation preserves table state (page, sort, filters, scroll). | Every destructive or irreversible action has confirm or undo. Table state survives detail open/close and route back. |
| H4 | Consistency & standards | Nielsen #4; Shneiderman #1; HIMSS "consistency" [S11] | Case view and cohort view share filter/sort/search/column semantics (VarLens parity rule). Icons, colours and chip meanings are consistent across views. | 0 parity divergences in filter/sort/column behaviour between case and cohort views |
| H5 | Error prevention / use-error robustness | Nielsen #5; Shneiderman #5; ISO 9241-110 "use error robustness"; IEC 62366-1 [S9] | Invalid filter values are blocked or explained inline. Classification cannot be saved to the wrong variant or case (identity is visible in the dialog header). | Every hazard-related scenario (wrong case/variant, wrong classification, silent filter exclusion) has a design mitigation |
| H6 | Recognition rather than recall | Nielsen #6; Shneiderman #8 (reduce STM load); Forsell & Johansson C6 [S8] | Active filters are visible as chips. Column meanings are available via header tooltip. Saved presets are listed. Comparison happens in place without memorising values across screens. | No task in the audited set requires remembering a value from another screen |
| H7 | Flexibility & efficiency | Nielsen #7; Forsell & Johansson E11/E7 (minimal actions) | Keyboard shortcuts for frequent actions (next/prev variant, open detail, classify). Saved filter presets. Column show/hide/reorder. | The core triage loop (open → inspect → classify → next) takes ≤ 3 interactions per variant and is fully keyboard-operable |
| H8 | Aesthetic & minimalist / information density | Nielsen #8; Gerhardt-Powals #8 (only needed info); ISO 9241-112 [S5] (detectability, discriminability, conciseness); F&J D10 (remove extraneous) | Key columns are visible at 1440 px width without horizontal scroll. Visual hierarchy separates primary from secondary data. Grouping is meaningful (Gerhardt-Powals #6). | The default column set fits 1440×900. ≥ 25 rows are visible in compact density at 1080p. |
| H9 | Error recognition & recovery | Nielsen #9; WCAG 3.3.1/3.3.3 | Error messages state what happened, why, and what to do next. IPC errors are not shown raw (`SerializableError` must be humanised). | 100 % of the error states sampled are human-readable and give a recovery action |
| H10 | Help & documentation | Nielsen #10; F&J B7 (orientation & help) | Contextual help for ACMG criteria, filter semantics and score columns (CADD, REVEL, SpliceAI cut-offs). Links to docs. | Every scored criterion and predictor column has an inline explanation |
| H11 | Data-table task support | NN/g data tables (4 tasks: find, compare, view/edit row, act on records) [S2]; NN/g filter/sort guidance [S3] | Find (filter + sort + search), compare (sticky header, frozen identifier column, aligned numerics with tabular figures), view row (detail panel keeps table context), bulk actions (multi-select). | All 4 tasks are supported. Sticky header and frozen first column are present. Numerics are right-aligned. |
| H12 | Dialog closure & feedback | Shneiderman #3/#4 | Multi-step flows (import, ACMG classification) show a clear completion state. | Every multi-step flow ends in an explicit success state |
| H13 | Clinical-dashboard heuristics | Dowding & Merrill 2018 [S10] | Data are accurate and legible, clinically meaningful aggregation is used (cohort), there is no chartjunk, and context (ref ranges/thresholds) is shown. | Cohort charts state denominators and thresholds |
| H14 | Context preservation | HIMSS 2009 principles (simplicity, naturalness, consistency, forgiveness/feedback, language, efficient interactions, information presentation, **preservation of context**, minimise cognitive load) [S11] | Opening a variant detail does not lose table scroll/selection. Patient/case identity stays visible at all times. | Case ID and sample are always visible. No context loss on panel open/close. |

**Severity scale for findings (Nielsen [S1]):** 0 = not a problem, 1 = cosmetic, 2 = minor (low priority), 3 = major (high priority), 4 = catastrophe (fix before release). Rate each finding on *frequency × impact × persistence*. For clinical tools, any finding that can lead to a **wrong classification or a missed variant** is at least 3 (this audit's rule, following the IEC 62366-1 hazard-related-use-scenario logic). Use 3–5 independent evaluators where possible. One evaluator finds about 35 % of problems and five find about 75 % [S1].

### A2. Clinical / medical usability (process criteria)

| # | Dimension | Source | Criterion | Pass |
|---|---|---|---|---|
| C1 | Use specification | IEC 62366-1:2015+A1:2020 §5.1 [S9] | Documented intended users (clinical geneticist, lab scientist, researcher), use environment and intended purpose | A use spec exists in `.planning/` |
| C2 | Hazard-related use scenarios | IEC 62366-1 §5.4–5.5; A1:2020 allows severity-based subset selection | Scenarios are listed: wrong case loaded, filter silently hiding a pathogenic variant, wrong transcript/HGVS displayed, ACMG criterion mis-applied, stale annotation | ≥ 1 mitigation per scenario. Each scenario is traced to UI elements. |
| C3 | Formative evaluation | IEC 62366-1 §5.7; FDA HFE 2026 [S13] | Iterative expert reviews or think-alouds with representative users | ≥ 1 formative round per major UI change |
| C4 | Summative evaluation (if ever regulated) | IEC 62366-1 §5.9; FDA HFE; NISTIR 7804 EUP [S12] | Representative participants (FDA convention: ≥ 15 per distinct user group), critical tasks, use-error/close-call/difficulty capture | N/A for a research tool. Note it as a gap if the intended purpose changes to IVD. |
| C5 | Regulatory qualification | MDCG 2019-11 Rev.1 [S16]; MDR/IVDR Annex VIII Rule 11 | Intended-purpose statement ("research use / not for diagnostic use" vs decision support) is explicit in-app and in docs | An explicit intended-use statement is present |
| C6 | Safety-enhanced design | AMIA 2013 recommendations [S11b]; ONC §170.315(g)(3) (UCD + summative per NISTIR 7742) | Critical displays (classification, zygosity, inheritance, sample) prevent misreading: no colour-only coding, units/build (GRCh37/38) shown | Genome build and transcript are always visible next to coordinates and HGVS |

### A3. Accessibility (WCAG 2.2 AA + APG)

| # | SC / pattern | Relevance to VarLens | Pass |
|---|---|---|---|
| A1 | 1.3.1 Info & Relationships | Real `<table>`/`role="grid"` with `<th scope>` / `columnheader`. Filter groups use `fieldset`/`legend` or `role="group"` with a label. | 0 axe violations (`th-has-data-cells`, `td-headers-attr`, `label`) |
| A2 | 1.4.1 Use of Color | ACMG class chips, impact colours and zygosity badges need text or shape, not colour alone | Every colour-coded status also carries text or an icon |
| A3 | 1.4.3 Contrast (min) | 4.5:1 for body text, 3:1 for ≥ 18.66 px bold / 24 px. Dense 12–13 px table text must meet 4.5:1. Watch the `surface` vs `surface-variant` pairing. | 0 failures in both light and dark theme |
| A4 | 1.4.10 Reflow | 320 CSS px. **Data tables are excepted** (two-dimensional scrolling allowed), but toolbars, dialogs and panels must reflow. | Dialogs and panels usable at 400 % zoom |
| A5 | 1.4.11 Non-text Contrast | 3:1 for input borders, focus rings, chip outlines, checkbox states, sort icons | 0 failures |
| A6 | 1.4.12 Text Spacing / 1.4.4 Resize Text | Fixed-height table cells must not clip text at 200 % or with spacing overrides | No clipped or overlapping content |
| A7 | 1.4.13 Content on Hover/Focus | Column-header and score tooltips must be dismissable (Esc), hoverable and persistent | All tooltips comply |
| A8 | 2.1.1 Keyboard / 2.1.2 No Trap | Grid navigation, filter menus, dialogs, Mol* viewer escape | 100 % of the core tasks can be done by keyboard |
| A9 | 2.1.4 Character Key Shortcuts | Single-key shortcuts (e.g. `j/k`, `c`) must be remappable/disable-able or active only on focus | Compliant |
| A10 | 2.4.3 Focus Order / 2.4.7 Focus Visible | Focus returns to the triggering row after the detail panel or dialog closes | Compliant |
| A11 | **2.4.11 Focus Not Obscured (Min) — new in 2.2** | Sticky table header/footer, app bar, bottom pagination bar, snackbars and the right-hand detail drawer must not *fully* hide the focused element. Use `scroll-padding-top/bottom` equal to the sticky heights. | 0 instances of a fully hidden focus |
| A12 | 2.4.6 Headings & Labels / 2.5.3 Label in Name | Icon-only buttons (filter, export, column menu) need accessible names that contain any visible text | 0 `button-name` violations |
| A13 | **2.5.7 Dragging Movements — new** | Column reorder/resize and range sliders (AF, CADD) need a single-pointer alternative (menu, numeric input) | Alternative present |
| A14 | **2.5.8 Target Size (Min) — new** | ≥ **24×24 CSS px**, or enough spacing that a 24 px circle per target does not overlap. Inline-in-text and "essential" exceptions apply. Dense-row icon buttons and chip close-"x" are the risk. | 0 failures. *Audit target: 32 px for primary row actions (stricter than WCAG).* |
| A15 | 3.2.2 On Input | Changing a filter must not move focus or navigate unexpectedly | Compliant |
| A16 | 3.3.1/3.3.2/3.3.3 Errors | Inline validation for numeric filters and import mapping | Compliant |
| A17 | **3.3.7 Redundant Entry (A) / 3.3.8 Accessible Authentication (AA) — new** | Do not re-ask case metadata within a flow. DB-encryption passphrase field must allow paste and password managers (no cognitive test). | Compliant |
| A18 | 4.1.2 Name, Role, Value | Vuetify custom controls (v-select, v-autocomplete, v-chip-group) expose state (`aria-expanded`, `aria-selected`, `aria-sort`) | 0 axe `aria-*` violations |
| A19 | 4.1.3 Status Messages | "1,234 variants match", "Classification saved" and import progress are announced via `aria-live`/`role=status` without moving focus | Present for result count, save and import |
| A20 | APG **Grid** (interactive table) [S21] | One tab stop into the grid, arrow keys between cells, Home/End, PageUp/Down. `aria-rowcount`/`aria-rowindex` when server-paginated or virtualised. `aria-sort` on the sorted header. | Either a full grid pattern, or a static *Table* pattern with natively focusable row actions (both acceptable). Mixing them is a fail. |
| A21 | APG **Combobox** | HPO term and gene autocomplete: `role=combobox`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, Esc closes, Enter selects | Compliant |
| A22 | APG **Dialog (Modal)** | Focus moves into the dialog, Tab is trapped, Esc closes, focus returns to the trigger, `aria-modal="true"`, labelled by title | Compliant |
| A23 | APG **Tabs / Disclosure** | Variant-detail tabs (arrow keys, `aria-selected`); expandable rows (`aria-expanded`) | Compliant |
| A24 | Automated baseline | axe-core (WCAG 2.2 A/AA tags) | **0 serious/critical** violations on every audited route and state (dialogs open, panels open). Automated checks cover about 30–57 % of WCAG issues, so manual review is required. |

Session time-out (2.2.1 Timing Adjustable) applies only to the web build with auth. The user must be warned and able to extend the session.

### A4. Performance & visual stability

| # | Metric | Source | Good / NI / Poor | VarLens pass threshold |
|---|---|---|---|---|
| P1 | **LCP** | CWV [S26] | ≤ 2.5 s / ≤ 4.0 s / > 4.0 s (p75 field) | ≤ 1.2 s cold start to the table shell on desktop (matches LH desktop p10) |
| P2 | **INP** | CWV [S26][S27] | ≤ 200 ms / ≤ 500 ms / > 500 ms | ≤ 200 ms p75 for filter apply, sort, row select, panel open. *Stretch: ≤ 100 ms* (Nielsen "instant") for row select and panel open. |
| P3 | **CLS** | CWV [S26] | ≤ 0.1 / ≤ 0.25 / > 0.25 | **≤ 0.02** per page load and **0** unexpected shifts during filter/sort/page change (stricter, see Section C). Shifts within 500 ms of user input are excluded by spec (`hadRecentInput`), so an "input-triggered" shift after 500 ms still counts. |
| P4 | FCP | Lighthouse [S28] | ≤ 1.8 s mobile, ≤ 0.93 s desktop (p10) | ≤ 0.9 s desktop |
| P5 | TBT (lab proxy for INP) | Lighthouse | ≤ 200 ms mobile, ≤ 150 ms desktop (p10) | ≤ 100 ms desktop on load |
| P6 | Long tasks / LoAF | Long Animation Frames API; RAIL [S33] | Tasks > 50 ms block input | No task > 50 ms in the filter-apply path (main thread) |
| P7 | Frame budget during scroll/animation | RAIL "Animation": ≤ 10 ms of work per frame (16.7 ms budget at 60 Hz) | — | Table scroll ≥ 55 fps on reference hardware |
| P8 | Response-time limits | Nielsen 0.1 s / 1 s / 10 s [S34]; Doherty threshold 400 ms [S35] | — | Feedback ≤ 100 ms. Query result ≤ 400 ms for ≤ 100k-variant case. Determinate progress bar for anything > 10 s (import, export). |
| P9 | Lighthouse Performance score | Lighthouse v10–13 weights: **TBT 30 %, LCP 25 %, CLS 25 %, FCP 10 %, SI 10 %** [S28] | 90–100 green / 50–89 orange / 0–49 red | ≥ 95 desktop preset on the web build. 100 is attainable (see A6). |
| P10 | Lighthouse Accessibility | axe-based, weighted by impact | — | **100** (necessary, not sufficient) |
| P11 | Lighthouse Best Practices | — | — | **100** |
| P12 | Lighthouse SEO | — | — | N/A for an authenticated or offline app. Expect < 100 if `noindex` is set. Document the exception rather than chase it. |

### A5. Satisfaction & workload instruments

| Instrument | Items / scale | Benchmark / threshold | Expert-review approximation |
|---|---|---|---|
| **SUS** (Brooke 1996) [S36] | 10 items, 5-pt, score 0–100 | Global mean ≈ **68** (Sauro). **≥ 80.3 ≈ grade A / top 10 %**. Bangor adjectives: ≈ 71 "good", ≈ 85 "excellent". | Each evaluator completes SUS as a persona after scripted tasks. Report it as "expert-estimated SUS" and never present it as user data. |
| **UMUX-Lite** [S37] | 2 items, 7-pt ("capabilities meet my requirements", "easy to use") | SUS-equivalent ≈ 0.65 × UMUX-Lite + 22.9 | Cheapest in-app pulse survey for real users |
| **SEQ** [S38] | 1 item, 7-pt, after each task | Historical mean ≈ **5.5**. Tasks < 5 are problematic. | Rate each scripted task. Flag tasks scored ≤ 4. |
| **NASA-TLX** (raw/RTLX) [S39] | 6 subscales, 0–100 | No universal cut-off. Compare designs or versions. Mental demand is the key subscale for variant triage. | Estimate mental demand and frustration per task, relative only |
| **SUPR-Q** [S40] | 8 items, percentile vs a website database | Designed for public websites | **Not appropriate** for an offline clinical tool. List it as excluded. |
| **Task success / time-on-task** | Binary or partial success. Median time (geometric mean for small n). | Average task completion across studies ≈ 78 % (Sauro) | KLM/GOMS keystroke counts per core task as an efficiency proxy |
| **HEART** (Rodden et al., CHI 2010) [S41] | Happiness, Engagement, Adoption, Retention, Task success → Goals-Signals-Metrics | — | Useful only if opt-in local telemetry exists (likely not, offline-first). Map to SUS/SEQ + task scripts instead. |

### A6. What "100" requires per Lighthouse category (authenticated SPA)

- **Performance:** each metric's score follows a log-normal curve. The p10 control point maps to score 0.90 and the median to 0.50 [S28][S29]. A displayed "100" needs a weighted score ≥ 0.995, so in practice every metric must sit at about the 0.995 point. *Derived* metric values that score about 0.995 (z = −2.576):

  | Metric | Desktop p10 / median | ≈ value for 0.995 | Mobile p10 / median | ≈ value for 0.995 |
  |---|---|---|---|---|
  | FCP | 934 / 1600 ms | ~540 ms | 1800 / 3000 ms | ~1.07 s |
  | SI | 1311 / 2300 ms | ~740 ms | 3387 / 5800 ms | ~1.97 s |
  | LCP | 1200 / 2400 ms | ~600 ms | 2500 / 4000 ms | ~1.55 s |
  | TBT | 150 / 350 ms | ~65 ms | 200 / 600 ms | ~65 ms |
  | CLS | 0.10 / 0.25 | ~0.04 | 0.10 / 0.25 | ~0.04 |

  For an authenticated SPA, measure the *post-login* route with the login cached (Lighthouse CI `puppeteerScript` + `disableStorageReset`, or Unlighthouse cookie/localStorage auth). Measure interactions with **Lighthouse user flows** in *timespan* mode, which reports TBT, CLS and INP for a scripted interaction. Use *snapshot* mode for a11y on states such as an open dialog [S32].
- **Accessibility 100:** every applicable axe audit passes. The weights mirror axe impact, so one critical failure costs heavily. Run it against snapshots of open dialogs, menus and drawers, not only the initial load.
- **Best Practices 100:** no `errors-in-console` (this includes failed fetches or 401s and Vue warnings promoted to errors), no deprecated APIs, no third-party cookies, valid source maps for large first-party JS, correct image aspect ratio and resolution, no paste-blocking inputs (`paste-preventing-inputs`), HTTPS (`localhost` is treated as a secure context), doctype and charset declared, and no "Issues" panel entries. The CSP/Trusted Types/COOP checks are listed under "Trust & Safety" and are informational, not scored.
- **SEO 100:** `is-crawlable` (no `noindex`), `<title>`, meta description, HTTP 200, descriptive link text, crawlable anchors (`href` on router links), valid robots.txt, image alt, hreflang/canonical if present. **An internal app that intentionally sets `noindex` cannot score 100. Record SEO as "not applicable".**

---

## B. Tool matrix

Legend: **OSS** = open source and free. **Auth** = how to run it against an authenticated `localhost` SPA (for VarLens, use the web build `VARLENS_WEB=1 make dev` → `http://localhost:8787/`, or the Electron app via Playwright `_electron`).

### B1. Accessibility

| Tool | Measures | Run locally / auth | License |
|---|---|---|---|
| **axe-core** (Deque) [S42] | Rule engine (~100 rules) with tags `wcag2a/2aa/21aa/22aa/best-practice`. Engine of Lighthouse a11y and many others. | Inject into any page, or use `@axe-core/cli`. Auth: run inside an already-logged-in Playwright context. | MPL-2.0 (OSS) |
| **@axe-core/playwright** | axe in Playwright tests: `new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()`. `.include()`/`.exclude()` to scope to a dialog. | **Works with Electron**: pass the `Page` from `_electron.launch().firstWindow()`. Add to `tests/e2e`. Assert 0 serious/critical. | MPL-2.0 |
| **axe DevTools** (extension) | Free tier: automated scan. Pro: Intelligent Guided Tests, IGT for tables/forms/modals. | Browser extension on the logged-in tab | Free tier + paid Pro |
| **Pa11y / pa11y-ci** [S43] | Runs axe and/or HTML_CodeSniffer (`runners: ['axe','htmlcs']`). CLI and CI with thresholds. | `actions: ["navigate to …/login", "set field #user to …", "click element #submit", "wait for url to be …"]`, or `headers`/`cookies` config. Supports `standard: WCAG2AA`. | LGPL-3.0 (OSS) |
| **IBM Equal Access Accessibility Checker** [S44] | Separate rule set (IBM Accessibility requirements ⇄ WCAG 2.2 / EN 301 549). Good second opinion to axe. | Browser extension, or `accessibility-checker` npm in Playwright/Puppeteer (`getCompliance(page, label)`). Baseline files for regressions. | Apache-2.0 (OSS) |
| **WAVE** (WebAIM) | Visual in-page overlay of errors, contrast and structure. Strong for reviewer orientation. | Browser extension works on authenticated pages. The API (paid) cannot easily auth. | Extension free. API paid. |
| **Accessibility Insights for Web** (Microsoft) [S45] | *FastPass* (axe automated + tab-stop visualiser) and *Assessment* (guided manual walk through all WCAG AA SCs). Best for the structured manual pass. | Extension on a logged-in Chrome/Edge tab | MIT (OSS) |
| Chrome DevTools a11y tree / CSS Overview | Accessibility tree, computed names, contrast issues per page | Built in | Free |
| Screen readers | NVDA (Windows, free), VoiceOver (macOS), Orca (Linux) | Manual test of grid, combobox and dialog | Free |

### B2. Performance & web vitals

| Tool | Measures | Run locally / auth | License |
|---|---|---|---|
| **Lighthouse 13** (CLI / DevTools / Node) [S30][S32] | Lab FCP, LCP, TBT, CLS, SI + insights. A11y/BP/SEO categories. **User-flow API**: navigation, timespan (interactions → INP/CLS/TBT), snapshot. | `lighthouse http://localhost:8787 --preset=desktop`. Auth: Puppeteer user-flow script logs in first. Electron: start with `--remote-debugging-port=9222`, then `lighthouse --port=9222` (works for a11y/BP snapshot; timings are less meaningful). | Apache-2.0 |
| **Lighthouse CI** (`@lhci/cli`) | Repeat runs (median of n=3–5), assertions (`categories:performance >= 0.95`, `cumulative-layout-shift <= 0.02`), budgets, server for history | `lhci autorun` with `collect.puppeteerScript` (login) + `settings.disableStorageReset: true`. `collect.startServerCommand` boots the web build. | Apache-2.0 |
| **Unlighthouse** [S46] | Site-wide crawl that runs Lighthouse on every route. Dashboard per route. | `npx unlighthouse --site http://localhost:8787`. Auth via config: `cookies`, `extraHeaders`, `localStorage`, `auth` (basic), or `hooks['authenticate']` with Puppeteer. SPA routes may need `urls: [...]` because the crawler cannot discover router-only routes. | MIT |
| **WebPageTest** | Filmstrip, waterfall, visual progress, CWV, scripting, "Opportunities & Experiments" | Hosted (Catchpoint; free tier, cannot reach localhost without a tunnel). Private instance is OSS but heavy to host. Script `setCookie`/`navigate` for auth. | Agent OSS. Hosted is freemium. |
| **sitespeed.io / browsertime** [S47] | Real-browser runs: visual metrics (SpeedIndex, VisualComplete85), CWV, video/filmstrip, Coach advice, HAR, CPU long tasks. Graphite/Grafana history. | Docker `sitespeedio/sitespeed.io http://host.docker.internal:8787`. Auth via `--preScript login.js` or `--browsertime.cookie`. User journeys via scripting (`commands.click`, `commands.measure.start/stop`), which is good for "apply filter" timing. | MIT |
| **Chrome DevTools Performance panel** | *Live metrics* (local LCP/CLS/INP with element attribution, interaction log), trace with Insights sidebar (LCP phases, CLS culprits, INP breakdown: input delay / processing / presentation), Layout Shift track, CPU throttling with calibration | Manual on a logged-in tab, or the Electron window via DevTools | Free |
| **web-vitals** JS (v5) + **attribution build** [S48] | Field-style `onLCP/onINP/onCLS/onFCP/onTTFB` (FID removed in v5). Attribution: CLS `largestShiftTarget`, INP `interactionTarget`, `inputDelay`/`processingDuration`/`presentationDelay`, `longAnimationFrameEntries`. | `import {onINP} from 'web-vitals/attribution'`. Log to `logService` in dev or perf mode. VarLens already has perf milestones (`app-ready`, `renderer-interactive`), which these extend. | Apache-2.0 |
| PerformanceObserver (`layout-shift`, `long-animation-frame`, `event`) | Raw shift, LoAF and event timing entries | In Playwright `page.evaluate` to assert CLS = 0 during scripted filter/sort (works in Electron) | Browser API |
| **Vue DevTools v7** (`vite-plugin-vue-devtools`) | Component render/update timeline, Pinia state, component inspector | Dev build only. `app.config.performance = true` adds `vue-*` marks to the DevTools Performance timeline. | MIT |

### B3. Visual regression & component testing

| Tool | Measures | Run locally / auth | License |
|---|---|---|---|
| **Playwright `toHaveScreenshot()`** | Pixel diff vs a committed baseline (`maxDiffPixelRatio`, `mask`, `animations: 'disabled'`, `caret: 'hide'`) | Works with `_electron` windows. Pin OS and fonts (Docker or a single CI OS) for stable baselines. **Also detects flicker**: screenshot at t0 and t0+300 ms after an action, then diff. | Apache-2.0 |
| **Chromatic** | Cloud visual review for Storybook/Playwright. UI-review workflow. | Needs Storybook or a Playwright integration. Cloud upload (check data policy: use synthetic fixtures only). | Freemium (5k snapshots/mo free) |
| **BackstopJS** | Scenario-based screenshot diff (Puppeteer/Playwright engine), HTML report | `onBeforeScript` for login cookies | MIT |
| Lost Pixel / Argos | OSS/freemium alternatives to Chromatic | — | MIT / freemium |
| **Storybook 9** + `@storybook/addon-a11y` + Vitest addon / test-runner | Per-component axe, interaction tests, visual tests | Isolated components, so no auth needed. Good for the table, filter chips and dialogs in all states (loading/empty/error). | MIT |

### B4. Bundle & load composition

| Tool | Measures | Run | License |
|---|---|---|---|
| **rollup-plugin-visualizer** | Treemap/sunburst of the Vite/Rollup bundle (gzip/brotli sizes) | Add to the electron-vite renderer config with `open:false, filename: 'stats.html'` | MIT |
| **source-map-explorer** | Bytes per source file from source maps | `npx source-map-explorer out/renderer/assets/*.js` | Apache-2.0 |
| vite-bundle-analyzer / Sonda | Alternatives with per-chunk import graphs | — | MIT |
| Chrome DevTools Coverage | Unused JS/CSS on a given route | Manual | Free |

### B5. Recommended minimal stack for this audit (all OSS)

1. **Playwright `_electron` + `@axe-core/playwright`** for a11y snapshots of every route and state (0 serious/critical).
2. **IBM Equal Access checker** as a second engine, plus an **Accessibility Insights Assessment** manual pass for the 2.2 SCs that automation misses (2.4.11, 2.5.7, 2.5.8 spacing, 1.4.13).
3. **Lighthouse 13 user flows + LHCI** on the web build (desktop preset, n=5 median) for the four categories plus timespan INP/CLS for filter/sort/panel interactions.
4. **web-vitals/attribution + PerformanceObserver** inside existing perf E2E (`renderer-perf-phase1.e2e.ts`) to assert CLS ≈ 0 and INP < 200 ms per interaction.
5. **Playwright screenshots** for visual regression and flicker detection.
6. **rollup-plugin-visualizer** for bundle composition.

---

## C. Vue 3 / Vuetify 4 anti-flicker, CLS & INP checklist

### C1. App shell & first paint (Electron + web)

- [ ] **Electron white flash:** `BrowserWindow({ show: false, backgroundColor: <theme bg> })` + `once('ready-to-show', show)`. The `backgroundColor` must match the *resolved* theme (light/dark) or the window shows a wrong-colour flash.
- [ ] **Theme flash (FOUC/FOIT of theme):** resolve the theme **synchronously before `createVuetify()`/`app.mount`**. Read the persisted preference (synchronous store or inline script in `index.html`), pass `theme.defaultTheme` (`'system'` is supported in recent Vuetify). Set `<meta name="color-scheme" content="light dark">` and an inline `html,body{background:…}` in `index.html` matching both themes via `prefers-color-scheme`.
- [ ] **Layout registration shift:** Vuetify layout items (`v-app-bar`, `v-navigation-drawer`, `v-footer`) register on mount and set `--v-layout-*` padding on `v-main`. **Never gate the drawer or app bar behind async data (`v-if` after fetch).** Render the shell synchronously and lazy-fill only its contents.
- [ ] **Drawer state:** persist `rail`/`permanent`/open state and read it before first render. Avoid `model-value` starting `null` (Vuetify then decides from the display breakpoint on mount, which causes an open→close jump). Set `display.mobileBreakpoint` explicitly.
- [ ] Disable layout transitions for the very first render if a drawer animates in at boot.
- [ ] **Detail side panel:** use an overlay (`temporary` drawer or `v-dialog`/`location="right"` overlay) **or** a reserved fixed-width column. A push drawer that resizes `v-main` reflows every table column and counts as a layout shift if it happens > 500 ms after the click.

### C2. Fonts & icons

- [ ] **Prefer SVG icons** (`@mdi/js` with `vuetify/iconsets/mdi-svg`) over the MDI webfont. This removes icon FOIT, ligature/blank-box flashes, and ~400 KB of font. Icons render with the JS chunk.
- [ ] If the MDI font is kept: self-host woff2, `<link rel="preload" as="font" crossorigin>`, and `font-display: block` for the *icon* font (swap would show the fallback as wrong glyphs).
- [ ] Text font (Roboto/Inter): self-host and preload the main weight. Use `font-display: swap` **plus a metric-matched fallback** (`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`; generate with Fontaine/Capsize) so the swap causes no reflow. Or use `optional` for zero shift. In Electron the fonts are local, so the risk is lower, but the web build is affected.
- [ ] `font-variant-numeric: tabular-nums` on counts, scores, AF and positions so live-updating numbers do not jitter in width.

### C3. Server data table (`v-data-table-server`)

- [ ] **Keep previous rows while loading.** Do not clear `items` before fetching. Known Vuetify behaviour: with `loading` true the body can be replaced by the loading text, so rows vanish and the page jumps (vuetify#18445). Mitigations: (a) use the `loading` slot or prop only when `items.length === 0` (first load), or (b) render a thin `v-progress-linear` in the header area (absolutely positioned, zero layout height) and dim rows (`opacity`/`aria-busy="true"`) during refetch.
- [ ] **Fixed geometry:** `fixed-header` + explicit `height` (or a container with `min-height` = rows × row-height + header). `density="compact"` with a CSS-fixed row height. Truncate cell text with ellipsis and tooltip rather than wrapping, so rows never grow after data arrives.
- [ ] **Stable footer/pagination:** `items-length` should keep its previous value during refetch (do not drop to 0, which collapses the footer and "Showing 0 of 0" flickers).
- [ ] **Empty vs loading vs error** are three distinct states with the **same reserved height**. Never swap a spinner for the table and back.
- [ ] First load: `v-skeleton-loader type="table-row@N"` sized to the real row height and count. Skeleton **only** for the first load (NN/g: skeletons for full-page/structure loads, not refreshes).
- [ ] **Delayed spinner pattern:** show a busy indicator only if the request exceeds ~300 ms, and keep it for ≥ ~400–500 ms once shown. This avoids sub-second flashes (Nielsen: under 1 s, no progress indicator is needed).
- [ ] Column-visibility changes and expanded rows: use `v-model:expanded` with **key strings** (VarLens rule). Animate height or use `content-visibility` to avoid abrupt jumps of rows below.
- [ ] Large client-side lists (cohort, HPO picker): `v-data-table-virtual`/`v-virtual-scroll` with a fixed `item-height`.
- [ ] Off-screen heavy sections in the detail panel (transcripts, literature, Mol*): `content-visibility: auto; contain-intrinsic-size: auto 400px;`. Reserve chart and Mol* containers with `aspect-ratio`/fixed height before lazy `import()`.

### C4. Toolbars, alerts & overlays

- [ ] Filter chips row: fixed min-height. Wrapping chips push the table down, so use horizontal scroll or a "+N more" overflow instead of wrapping.
- [ ] Banners and alerts ("annotation outdated", errors): use `v-snackbar` (overlay) or a pre-reserved slot. Inserting a `v-alert` above the table is a classic CLS source.
- [ ] Menus, tooltips and autocompletes are overlays (no CLS). Verify `v-menu` does not force `scroll-lock` reflow (scrollbar disappearance shifts layout). Use `scrollbar-gutter: stable` on the scroll container.
- [ ] Sticky elements + focus: `scroll-padding-top/bottom` equal to sticky header/footer heights (WCAG 2.4.11).

### C5. Route & view transitions

- [ ] `<KeepAlive include="CaseVariantsView,CohortView">` around `<RouterView>` so back-navigation restores the table instantly with scroll and state (H3/H14) instead of remount + refetch + spinner.
- [ ] `<Suspense>` with a `timeout` (e.g. 300 ms) so fast async components never flash their fallback.
- [ ] **View Transitions API** (same-document; `document.startViewTransition`, hooked in `router.beforeResolve`). Chromium, so Electron has it, and Safari 18+ support it. Use it for case→variant or table→detail morphs and keep the duration ≤ 200–250 ms. Respect `prefers-reduced-motion`. Not a CLS fix in itself, because the new DOM must still be stable.
- [ ] Avoid `v-if` toggles of large subtrees on hover or selection. Use `v-show` or CSS.

### C6. INP (responsiveness) for filter / sort / select

- [ ] Debounce text and range filters (150–300 ms). Commit on Enter or blur for expensive queries. Give **immediate** visual feedback (≤ 100 ms) even if the query is debounced.
- [ ] Keep row data non-reactive: `shallowRef` for the items array and `markRaw` for row objects. Avoid `deep` watchers on large arrays and filter state.
- [ ] Row selection must not re-render all rows: per-row components keyed by stable ID, `v-memo="[row.id === selectedId]"` where useful.
- [ ] Yield in long JS work: `await scheduler.yield()` (Chromium 129+) or chunk into tasks < 50 ms. Move heavy transforms (cohort aggregation, sorting of client-side sets, large JSON parse) into a Web Worker or the main-process DB worker.
- [ ] Avoid layout thrash in handlers: no `offsetHeight` reads after style writes in loops. Batch with `requestAnimationFrame`.
- [ ] Measure with web-vitals attribution and split INP into input delay / processing / presentation. Presentation delay > 100 ms usually means too much DOM: reduce rendered columns or use virtualisation.

### C7. Verification hooks

- [ ] Playwright perf E2E: `PerformanceObserver({type:'layout-shift', buffered:true})`. Sum `value` where `!hadRecentInput` across: cold load, filter apply, sort, page change, panel open/close. **Assert ≤ 0.02 load, 0 interaction.**
- [ ] Assert `event` timing / `onINP` ≤ 200 ms per scripted interaction (median of 5).
- [ ] Flicker test: screenshots at +50/+150/+300 ms after an action. No frame may show an empty table body or a "No data" text while a refetch is in flight.

---

## D. Sources

| # | Source | URL | What it gives us |
|---|---|---|---|
| S1 | NN/g — 10 Usability Heuristics; Severity Ratings; How to Conduct a Heuristic Evaluation | https://www.nngroup.com/articles/ten-usability-heuristics/ · https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/ · https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/ | 10 heuristics. Severity 0–4 (frequency, impact, persistence). 3–5 evaluators. |
| S2 | NN/g — Data Tables: Four Major User Tasks | https://www.nngroup.com/articles/data-tables/ | Find / compare / view-edit row / act on records |
| S3 | NN/g — Filters vs Facets; Sorting; Progress indicators; Skeleton screens | https://www.nngroup.com/articles/filters-vs-facets/ · https://www.nngroup.com/articles/progress-indicators/ · https://www.nngroup.com/articles/skeleton-screens/ | Filter UI patterns. Spinner for 2–10 s, percent-done for > 10 s. Skeletons for page-structure loads. |
| S4 | ISO 9241-110:2020 Interaction principles (preview); Wikipedia ISO 9241 | https://webstore.ansi.org/preview-pages/ISO/preview_ISO+9241-110-2020.pdf · https://en.wikipedia.org/wiki/ISO_9241 | 7 principles: suitability for tasks, self-descriptiveness, conformity with expectations, learnability, controllability, use-error robustness, user engagement (new in 2020; individualisation folded into controllability) |
| S4b | ISO 9241-11:2018; ISO 9241-210:2019 | https://www.iso.org/standard/63500.html · https://www.iso.org/standard/77520.html | Usability = effectiveness, efficiency, satisfaction for specified users, goals and context. HCD: 6 principles (understand users/tasks/env; involve users; evaluation-driven; iterative; whole UX; multidisciplinary). |
| S5 | ISO 9241-112:2017 Principles for presentation of information | https://www.iso.org/standard/64840.html | Detectability, freedom from distraction, discriminability, interpretability, conciseness, internal and external consistency. Directly applicable to dense tables. |
| S6 | Shneiderman — Eight Golden Rules of Interface Design | https://www.cs.umd.edu/~ben/goldenrules.html | Consistency, universal usability, informative feedback, closure, error prevention, easy reversal, user control, reduce STM load |
| S7 | Gerhardt-Powals (1996) Cognitive engineering principles, *Int J Hum-Comput Interact* 8(2) | https://doi.org/10.1080/10447319609526147 | 10 principles: automate unwanted workload, reduce uncertainty, fuse data, meaningful aids, function-related names, consistent grouping, limit data-driven tasks, only needed info, multiple coding, judicious redundancy |
| S8 | Forsell & Johansson (2010) An heuristic set for evaluation in information visualization, AVI '10 | https://doi.org/10.1145/1842993.1843029 | 10 infovis heuristics (information coding, minimal actions, flexibility, orientation & help, spatial organisation, consistency, recognition vs recall, prompting, remove extraneous, data-set reduction) |
| S9 | IEC 62366-1:2015 + A1:2020 (Emergo/MedicalDeviceHQ summaries) | https://www.emergobyul.com/news/2020-amendments-iec-62366-implications-medical-device-usability-engineering · https://medicaldevicehq.com/articles/what-is-new-iec-62366-1-amd12020/ | Usability engineering process. A1:2020: participants must be justified as representative, severity-based selection of hazard-related scenarios for summative, justification of test environment. |
| S10 | Dowding & Merrill (2018) Development of heuristics for evaluation of dashboard visualizations, *Appl Clin Inform* 9(3) | https://doi.org/10.1055/s-0038-1666842 | Healthcare-dashboard heuristic checklist |
| S11 | HIMSS (2009) Defining and Testing EMR Usability | https://www.himss.org/resources/defining-and-testing-emr-usability-principles-and-proposed-methods-emr-usability-evaluation | 9 principles incl. preservation of context and minimising cognitive load |
| S11b | Middleton et al. (2013) AMIA recommendations on EHR usability, *JAMIA* 20(e1) | https://doi.org/10.1136/amiajnl-2012-001458 | Usability-safety recommendations for vendors, users and policy |
| S12 | NISTIR 7804 (2012) EHR Usability Protocol; NISTIR 7804-1 (2015) Technical basis for UI design of health IT; NISTIR 7865 (2012) Pediatric EHR human factors guide; NIST Health IT usability program | https://nvlpubs.nist.gov/nistpubs/ir/2012/NIST.IR.7804.pdf · https://www.nist.gov/document/nistir7804-1werb100615pdf · https://www.nist.gov/programs-projects/health-information-technology-usability | EUP: expert review → summative validation with critical tasks and use-error capture. 7804-1: safety-related UI guidelines (identification, consistency, alert design). |
| S13 | FDA (rev. 2026-08-03) Applying HF & Usability Engineering to Medical Devices — summaries | https://www.emergobyul.com/news/fda-updates-landmark-human-factors-guidance-medical-devices · https://research-collective.com/revised-human-factors-guidance/ | Harmonised with IEC 62366-1 and QMSR. Formative definition aligned. HF report content moved to a separate guidance. |
| S14 | FDA final guidance — Content of HF Information in Medical Device Marketing Submissions (2026) | https://www.exponent.com/article/fda-finalizes-human-factors-guidance-medical-device-marketing-submissions · https://emergobyul.com/news/key-updates-final-fda-guidance-content-human-factors-information-medical-device-marketing | Risk-based HF submission categories |
| S15 | FDA draft (Jan 2025) AI-Enabled Device Software Functions | https://www.emergobyul.com/resources/fda-guidance-overview-human-factors-expectations-ai-enabled-products | HF expectations for AI outputs and transparency |
| S16 | MDCG 2019-11 Rev.1 (2025) software qualification & classification | https://gmpinsiders.com/mdcg-2019-11-rev1-mdr-ivdr/ · https://mdrregulator.com/news/revised-mdcg-2019-11-guidance-updated-approach-to-qualification-and-classification-of-medical-software | Decision trees, decision-support borderline cases, Rule 11 alignment |
| S17 | Sidley — CDS in US vs EU; IJHPM commentary | https://goodlifesci.sidley.com/?p=1590 · https://ijhpm.com/article_4468.html | Divergent Class I vs IIa interpretations for decision-support MDSW |
| S18 | Variant-curation tool usability studies: ClinGen VCI (Preston et al. 2022, *Genome Med* 14:6); AnalyzeMyVariant context-of-use study (UW); GeneInsight Clinic usability (*Appl Clin Inform* 2016); CRIBOMICS UCD (SHTI 2021) | https://doi.org/10.1186/s13073-021-01004-8 · https://digital.lib.washington.edu/researchworks/items/67bc8206-1cc6-4f3c-9458-599d03c4cb5a · https://doi.org/10.4338/ACI-2015-11-RA-0162 · https://ebooks.iospress.nl/pdf/doi/10.3233/SHTI210855 | Sparse literature. Findings: experts rate tools well overall but struggle to interpret UI elements. Evidence-criteria structuring (ACMG) and audit trails are core. UCD reduces prioritisation time and errors. |
| S20 | W3C WCAG 2.2 + Understanding docs | https://www.w3.org/TR/WCAG22/ · https://www.w3.org/WAI/WCAG22/Understanding/ | SC text. 2.4.11, 2.5.7, 2.5.8 (24×24 px), 3.3.7, 3.3.8 new. 4.1.1 obsolete. |
| S21 | WAI-ARIA Authoring Practices Guide — Grid, Table, Sortable Table, Combobox, Dialog (Modal), Tabs, Disclosure | https://www.w3.org/WAI/ARIA/apg/patterns/ | Keyboard and ARIA contracts used in A20–A23 |
| S22 | W3C — WCAG 3 Introduction; WCAG 3 WD Mar 2026 | https://www.w3.org/WAI/WCAG3 · https://www.w3.org/WAI/news/2026-03-03/wcag3 | Working Draft. Not normative. Recommendation ≥ 2028 (secondary sources). |
| S23 | Deque — EN 301 549 v4.1.1 is final; DWT EAA standards update (2026-09) | https://www.deque.com/blog/en-301-549-v4-1-1-is-final-what-changed-what-it-means-and-what-you-should-do/ · https://www.dwt.com/insights/2026/09/european-accessibility-act-ict-standards-update | V4.1.1 published 2026-09-02, WCAG 2.2 aligned. OJ citation expected late 2026. |
| S24 | EAA enforcement (Inside Global Tech; PageCrawl) | https://www.insideglobaltech.com/2025/06/10/european-accessibility-act-june-2025-deadline-has-arrived/ · https://pagecrawl.io/blog/european-accessibility-act-compliance-monitoring-wcag | Enforceable 2025-06-28. 2026 inspections. Accessibility statements. |
| S25 | Directive (EU) 2019/882 (EAA) | https://eur-lex.europa.eu/eli/dir/2019/882/oj | Scope (consumer products and services) |
| S26 | web.dev — Web Vitals; INP; CLS; LCP | https://web.dev/articles/vitals · https://web.dev/articles/inp · https://web.dev/articles/cls · https://web.dev/articles/lcp | Thresholds at p75. CLS session windows (1 s gap, 5 s max). `hadRecentInput` 500 ms exclusion. |
| S27 | web.dev — Defining the Core Web Vitals thresholds | https://web.dev/articles/defining-core-web-vitals-thresholds | Rationale for 200/500 ms INP |
| S28 | Chrome for Developers — Lighthouse performance scoring | https://developer.chrome.com/docs/lighthouse/performance/performance-scoring | Weights TBT 30 / LCP 25 / CLS 25 / FCP 10 / SI 10. Log-normal curves (p10 → 90, median → 50). Bands 0–49/50–89/90–100. |
| S29 | Lighthouse source — metric scoring options | https://github.com/GoogleChrome/lighthouse/tree/main/core/audits/metrics | Mobile/desktop p10 and median control points (e.g. LCP 2500/4000 mobile, 1200/2400 desktop) |
| S30 | Chrome for Developers — Lighthouse 13 release notes (2025-10-10) | https://developer.chrome.com/blog/lighthouse-13-0 | Insight audits replace legacy audits. Removed audits. No scoring change. Node 22.19. |
| S31 | Chrome for Developers — Lighthouse is moving to performance insight audits | https://developer.chrome.com/blog/moving-lighthouse-to-insights | Audit → insight mapping |
| S32 | Lighthouse user flows; Lighthouse CI docs (auth, puppeteerScript) | https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md · https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md | Navigation/timespan/snapshot modes. `puppeteerScript` + `disableStorageReset` for login. |
| S33 | web.dev — RAIL model; Long Animation Frames API | https://web.dev/articles/rail · https://developer.chrome.com/docs/web-platform/long-animation-frames | Response < 100 ms (handle in 50 ms), Animation 10 ms/frame, Idle 50 ms chunks, Load. LoAF attribution. |
| S34 | NN/g — Response Times: The 3 Important Limits | https://www.nngroup.com/articles/response-times-3-important-limits/ | 0.1 s instant, 1 s flow, 10 s attention |
| S35 | Doherty & Thadani (1982) IBM; Laws of UX — Doherty Threshold | https://lawsofux.com/doherty-threshold/ | Productivity rises sharply when system response is < 400 ms |
| S36 | Brooke (1996) SUS; Sauro — Measuring U SUS benchmarks; Bangor et al. (2009) adjective scale, *J Usability Stud* 4(3) | https://measuringu.com/sus/ · https://uxpajournal.org/determining-what-individual-sus-scores-mean-adding-an-adjective-rating-scale/ | Mean 68. A ≥ 80.3. Adjective anchors. |
| S37 | Lewis, Utesch & Maher (2013) UMUX-LITE, CHI | https://doi.org/10.1145/2470654.2481287 | 2 items. SUS regression (0.65x + 22.9). |
| S38 | Sauro — Single Ease Question | https://measuringu.com/seq10/ | 7-pt. Mean ≈ 5.5. |
| S39 | NASA TLX | https://humansystems.arc.nasa.gov/groups/tlx/ | 6 subscales. Raw TLX acceptable. |
| S40 | SUPR-Q | https://measuringu.com/suprq/ | 8-item website instrument (excluded for VarLens) |
| S41 | Rodden, Hutchinson & Fu (2010) HEART, CHI | https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/ | HEART + Goals-Signals-Metrics |
| S42 | axe-core; @axe-core/playwright; Playwright accessibility testing guide | https://github.com/dequelabs/axe-core · https://playwright.dev/docs/accessibility-testing | Rule tags incl. `wcag22aa`. Usage in Playwright. |
| S43 | Pa11y / pa11y-ci | https://github.com/pa11y/pa11y · https://github.com/pa11y/pa11y-ci | Actions for login. axe/htmlcs runners. Thresholds. |
| S44 | IBM Equal Access Accessibility Checker | https://github.com/IBMa/equal-access | Extension + `accessibility-checker` npm, baselines |
| S45 | Accessibility Insights for Web | https://accessibilityinsights.io/docs/web/overview/ | FastPass + guided Assessment |
| S46 | Unlighthouse — Authentication guide; Lighthouse on authenticated pages with Playwright | https://unlighthouse.dev/guide/guides/authentication · https://unlighthouse.dev/learn-lighthouse/playwright/authentication | Cookie/header/localStorage/programmatic auth |
| S47 | sitespeed.io / browsertime docs | https://www.sitespeed.io/documentation/sitespeed.io/scripting/ | preScript login, user-journey scripting, visual metrics |
| S48 | GoogleChrome/web-vitals (attribution build) | https://github.com/GoogleChrome/web-vitals | `onINP`/`onCLS` attribution fields. v5 API. |
| S49 | Vuetify issue #18445 — rows disappear when `loading` is set | https://github.com/vuetifyjs/vuetify/issues/18445 | Root cause of the table loading-state flicker (C3) |
| S50 | Vuetify docs — Application layout, Display & breakpoints, Icon fonts (mdi-svg), Theme | https://vuetifyjs.com/en/features/application-layout/ · https://vuetifyjs.com/en/features/icon-fonts/ · https://vuetifyjs.com/en/features/theme/ | Layout registration, SVG iconset, `defaultTheme` |
| S51 | MDN / Chrome — View Transitions API; `content-visibility`; `font-display`, `size-adjust`; `scheduler.yield()` | https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API · https://web.dev/articles/content-visibility · https://web.dev/articles/css-size-adjust · https://developer.chrome.com/blog/use-scheduler-yield | Techniques in Section C |
| S52 | Electron — BrowserWindow `ready-to-show` / `backgroundColor` | https://www.electronjs.org/docs/latest/api/browser-window#showing-the-window-gracefully | Avoids the white flash at window creation |

**Confidence notes:**
- The Lighthouse "≈ value for 0.995" column is derived from the published control points under a log-normal assumption. Treat it as ±10 %.
- EN 301 549 OJ-citation timing and the 2026 FDA revision come from consultancy and legal summaries (S13, S23), not the primary documents. Re-check them before citing externally.
- The automated-coverage range for axe (30–57 %) is vendor-reported.
- The variant-curation usability literature is thin. No standard UX benchmark exists for this tool class, so VarLens should define its own task-based baseline (core triage loop) and re-measure per release.
