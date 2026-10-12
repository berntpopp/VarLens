# VarLens — Combined UI/UX Audit, 2026-10-12

**Build:** v0.83.0 (`bfd3d80e`), web mode (Postgres, port 8797, 75 ms→0 ms latency gate server) + Electron 43 desktop build.
**Data:** 10 seeded cases (3 synthetic JSON, HG002 VEP + SnpEff 1,585 variants each, trio proband, SV, CNV, STR, edge cases), plus cases imported by the agents.
**Method:** impeccable dual assessment — independent design reviews (A: `02` case workflow, `03` details/viewers, `04` cohort/import/settings, `06` Electron) and a separate detector/technical pass (B: `05`), scored on the 14-dimension 0–100 schema in `01`. Design direction research in `07`.
**Product-owner rule applied:** small text and controls are intentional (density, small screens). Nothing is scored down for size; legibility at size is.
**Caveats:** one evaluator per area (schema asks ≥2); 3D WebGL rendering not verifiable headless; screen readers not used; agents shared one server, so case counts moved during the run.

## 1. Scorecard

| View | vw | Design (A) | Technical (B) | Combined |
|---|---|---|---|---|
| Login + disclaimer | 3 | 87.5 | 94 | **90** |
| Home / case list / shell | 8 | 70.6 | 74 | **72** |
| Case variant table | 22 | 54.1 | 64 | **58** |
| Variant details panel | 16 | 43 | 61 | **50** |
| Gene schema / lollipop | 6 | 44 | 42 | **43** |
| 3D structure | 4 | 50 | n/a | **50** |
| Cohort + gene burden | 13 | 50.4 | 64 | **55** |
| Case metadata / annotations | 5 | 63 | — | **63** |
| Import | 9 | 59.5 | 75 | **65** |
| Export | 5 | 80.2 | — | **80** |
| Settings / theme / admin | 4 | 71 | 80 | **74** |
| About / FAQ | 2 | 67.6 | — | **68** |
| Keyboard shortcuts | 3 | 64.1 | — | **64** |

Combined = (63·A + 37·B)/100, by the schema weights of the dimensions each pass owned.

- **Web overall: O_raw = 60 → O = 49** (binding cap: open P0 F-01). Without the P0: 60, "needs work". The per-interaction CLS budget (panel open 0.21) would cap at 79.
- **Desktop (Electron, `06`): 67.6**, no P0.
- **Nielsen 10 heuristics per area:** case workflow 24/40 · details 20/40 · cohort/import/settings 22/40 · desktop 23/40 (baseline 20/40).
- **Baseline 2026-10-06: ≈46** (different, equal-weight method; direction comparable, not the exact number).

### What got much better since 2026-10-06
- axe: 0 serious/critical in 20/22 web states (was 100–250 per view). Lighthouse desktop Perf 0.98–1.00, A11y 1.00, BP 1.00.
- INP 25–57 ms desktop (was 247 ms), 82–203 ms mobile (was 1,192 ms).
- Table refetch on sort/page/filter/search: 0 skeleton frames, CLS 0 (old #1 flicker problem is gone).
- Data integrity of the case table: 10/10 known-answer tasks and all 24 sorts correct; all 4 old P0s in the table are fixed.
- Desktop: interactive in 343–428 ms, VCF import < 0.5 s, keyboard triage loop and ACMG undo work.
- Prior findings: **77 fixed**, 39 still open, 1 regressed (theme flash direction), across all reports.

## 2. Findings that can lead to wrong or missed data (fix first)

| ID | Sev | Finding | Root cause (verified / suspected) | Report |
|---|---|---|---|---|
| F-01 | **P0** | Hidden Shortlist table still answers ↓/Enter/`s`: Enter opened MTMR3 while EMID1 was highlighted; `s` starred a hidden variant | Key handlers lack an active-view check; table kept alive (`ShortlistTable.vue:206-250`, `CaseView.vue:474`) | 03 |
| I-01 | P1 | JSON import silently shifts columns when a row is shorter than the header. The ui-gates fixture `columnar-format.json.gz` has 19 header fields and 18 values per row (`selectedTranscript` missing), so gnomAD AF = CADD, CADD = quality, ClinVar lost. The UI gates measure corrupted data. **Verified in fixture.** | No row-length check in `import-mapper-pipeline.ts`; fixture malformed | 04 |
| D-01 | P1 | Active DSL filter shows "No filters applied" (68/1,585 rows, case and cohort) | Chip list ignores DSL (`SlimFilterToolbar.vue:180`) | 02, 04 |
| D-02 | P1 | Malformed DSL / unknown field: server 400/500, UI says "No variants match your filters" | No error branch (`VariantTable.vue:234`) | 02 |
| P-01 | P1 | Details panel shows no ClinVar significance and no GT/DP/GQ/AB/FILTER | Missing sections | 03 |
| P-02 | P1 | Quick "P" chip saves Pathogenic while evidence says VUS (2 pts), no override marker/reason | Quick-set bypasses evidence model | 03 |
| P-03 | P1 | Esc while editing a comment saves it and closes the panel | Esc handled by panel before field | 03 |
| N-01 | P1 | After browser Back, sidebar highlights another case than the table shows | `CaseList.vue:205` local selection not synced from route | 02 |
| L-01 | P1 | Lollipop is an empty SVG, no message | `useProteinData.ts:49` `??` keeps length 0 instead of 683 | 03 |
| C-01 | P1 | ClinVar classes in lollipop/3D separated by red/green only; LP vs LB ΔE 2.5 under deuteranopia | Hard-coded palette | 05 |
| E-01 | P1 | Desktop gene burden never finishes ("52/52 genes"), Cancel does nothing | `WorkerPool.ts:66` waits for exit; `statistics/worker.ts` never exits (suspected) | 06 |
| E-02 | P1 | Desktop: imported cases don't appear until window reload | `isWebRuntime()` guard + listener ignoring wizard run in `App.vue` (suspected) | 06 |
| E-03 | P1 | Desktop export can overwrite the open database file | No guard on save path | 06 |
| E-04 | P1 | Desktop "Open…" on encrypted DB does nothing | `DatabasePicker.vue:355` | 06 |
| E-05 | P1 | Desktop without OS keyring: first run has no DB but invites import, then generic DB error | First-run flow | 06 |
| H-01 | P1 | FAQ claims nothing leaves the machine; web edition has external lookups | Copy | 04 |
| R-01 | P1 | At 390 px / 200 % zoom, Chr/Pos/Ref/Alt hidden first (row = "ZNRF3 · MODIFIER"); 720×450 pagination unreachable | Column priority in `utils/responsive-layout.ts:51` | 02 |

## 3. Cross-cutting UX/visual problems (found by ≥2 agents independently)

| ID | Sev | Finding | Agents |
|---|---|---|---|
| X-01 | P1 | **Opening/closing the details panel shifts the table 22 px (CLS 0.21/0.31)**: preset chip row wraps to two lines when the toolbar narrows | 02, 03, 05, 06 |
| X-02 | P1 | **Focus ring invisible on all 9 app-bar controls** (primary on primary, `custom.css:104`) | 05 |
| X-03 | P1 | Columns drawer: 26 unnamed checkboxes (axe critical); drawers aren't in the CI gate states | 05 |
| X-04 | P2 | **Dark theme app bar is a bright light-blue slab** — loudest element on screen | 02, 03, 04, 05, 06 |
| X-05 | P2 | **HGVS broken**: transcript prefix doubled (`ENST…:ENST….6:c.`), `p.Val74%3D` not decoded, Copy copies the broken string, no genome build | 02, 03, 06 |
| X-06 | P2 | **Esc closes neither drawer** (case + cohort) and drawers don't take focus; shortcut sheet claims it does; focus not returned after dialogs | 02, 04, 05 |
| X-07 | P2 | **Theme flash**: dark-OS users get light→dark flash on login/launch (`login.html`/`index.html` hard-coded light) | 04, 05, 06 |
| X-08 | P2 | **Low-contrast hard-coded Material colours**: ACMG evidence buttons 1.97–4.22:1, score chips 1.81–2.59:1, ClinVar chips ~2.1:1, Fetch VEP 2.31:1 dark | 03, 05, 06 |
| X-09 | P2 | **Colour semantics collide**: `error` vs `warning` ΔE 7.4, VUS ≈ Pathogenic (ΔE 7.7, 4.6 deutan); toolbar ACMG chips ≠ row/panel ACMG colours; gnomAD AF painted red | 02, 03, 05 |
| X-10 | P2 | **Faint mono**: Ref/Alt/HGVS in hairline Courier New 0.85em; `--font-mono` token unused; no UI font bundled → Arial/DejaVu per OS | 02, 07 |
| X-11 | P2 | Raw/inconsistent formatting: raw SO terms, three empty glyphs, SV length −5000, `full_mutation`, "Cached from 8/23/58749" (ms×1000), STR loci "Unknown Gene" | 02, 03, 04 |
| X-12 | P2 | Errors shown raw/generic: upload errors as JSON, duplicate case name → "unexpected error", damaged file → "Incorrect password", burden warnings as raw codes | 04, 06 |

## 4. Other notable P2s by area
- **Case table:** default columns need 2,032 px vs 1,150 visible at 1440; sticky header's first cells covered (missing `top:0`); filter drawer closes after each click; page not in URL; Impact filter lacks MODIFIER/"missing"; AF chip doesn't say "includes missing AF"; mobile table jumps 26 px per filter change (CLS 0.18).
- **Details:** panel keeps scroll on next variant (lands on ACMG, no gene/HGVS visible); heading never names the variant; score chips meaning by colour only, no thresholds; dark-mode plot labels and 3D side text invisible; gene-structure ticks repeat, exon labels overlap; metadata Sex stale until reload; HPO search keeps last term.
- **Cohort:** SV/CNV/STR tabs show SNV columns; `/` and Ctrl+Shift+F not wired (`App.vue:410-422`); invalid DSL dropped (case applies it); denominator mixes variant types; `1` vs `chr1` counted separately (carriers undercounted); Carriers/Frequency off-screen at ≤1440; "View in Case" opens empty Shortlist; burden summary 55 genes vs table 69; page-load CLS 0.042–0.093.
- **Import:** one bad file aborts the batch; "Auto-detected" build claimed when nothing detected; duplicate/empty case names accepted.
- **Settings/admin:** after sign-out, Back shows a broken shell; Create User wrong error for short password.
- **Desktop:** last DB not reopened; export omits ACMG/comments and writes AF as text; burden progress label unreadable; cohort counts mix types.

## 5. Design direction (from `07`, constrained by the density rule)
Data loud, chrome quiet · one bundled type system (Inter + JetBrains/Plex Mono, tabular nums) · 13 px body/cells in every density, density changes spacing only (28/32/40 px rows) · contrast rises as size falls (≥7:1 primary data and 11 px labels) · colour reserved for 4 clinical scales, always with text · every column header explains itself (definition + thresholds) · empty states explain *why* with one-click relaxations · shortcuts shown in tooltips + Ctrl/⌘K palette from one action list · panel overlays below ~1100 px content width, sidebar collapses to a rail below 1400 px, priority column tiers with Gene/HGVS frozen.

## 6. Test-data side effects
Shared server schema `uiux1012_*` now has extra cases (`audit-import-*`, `synthetic-sv`, `synthetic-cnv`), user `audit-user`, tag `audit-tag`. Case 4 edits were reverted. One Electron session stored a key in the GNOME keyring under app name "Electron".
