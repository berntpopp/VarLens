# 15 — Review PR 3 `fix/theme-semantic-colours` (8 commits, 44 files, +571/−322)

**What this change does:** one CVD-checked colour map (`SEMANTIC_COLORS`, `ACMG_COLORS`/`IMPACT_COLORS`/`ZYGOSITY_COLORS`/`SCORE_THRESHOLDS` in `domain.config.ts`) is spread into both Vuetify themes and fed to chips, filters, lollipop, gene structure and Mol*. It also adds an app-bar token pair and an on-bar focus ring, makes the pre-mount page and the Electron window follow the OS colour scheme, and plots ClinVar "conflicting" as `other`, not pathogenic. Assumed load: one desktop user.

**Checked:** (1) config: ACMG/ClinVar/impact/zygosity/CADD consumers and filter options all read the shared maps; token names are fine for every `ACMG_COLORS` caller (they all use `:color`, not inline CSS). (2) My own colorjs.io run (Machado 1.0, P/D/T, ΔE00). ACMG: light P~LP 11.6 (tritan), dark P~LP 11.0 (deutan). Impact: light 12.4, dark 15.1. Every token is ≥5.10:1 on the light surface (`acmg-lp` is the lowest) and ≥5.40:1 on the dark one (`acmg-b`). (3) Treating conflicting as not-P is correct: in ClinVar it is an aggregate status, not a call. All six protein/3D callers go through `getClinVarCategory`. (4) No inline script is added, the CSP is unchanged, and `sandbox`/`contextIsolation`/`nodeIntegration` are untouched. Only `backgroundColor` reads `nativeTheme`. (5) There are no new `surface-variant` backgrounds, and the app bar is themed in dark mode. (6) No size props changed. (7) `colorjs.io` is pinned to exactly `0.7.1` as a devDependency. Only the test imports it, so it is not bundled.

**Must fix**
1. **Overview ACMG chips still use the old palette** (`database-overview/OverviewStatsGrid.vue:96-110`). They use `deep-orange`/`amber`/`light-green`/`success`, so VUS shows amber (1.57:1) and LB light-green (2.03:1), unlike every other ACMG chip. Fix: `:color="ACMG_COLORS[...]"`, the same 5 lines. If skipped, the one-source claim is false and the overview is misleading and below AA.

**Should fix**
2. **Score chips collapse red/green under deuteranopia** (`utils/scoreThresholds.ts:20`). The low-concern tier returns `success`, and `error`~`success` is ΔE 3.8 (light, deutan). The table's `getCaddColor` uses `info` for the same tier. Fix: `'success'` → `'info'`, and add a `score` scale to `SCALES` in the test.
3. **ClinVar LB ~ conflicting are too close** (`severity.config.ts` + `vuetify.ts` `clinvar-conflicting`). They are ΔE 7.3 (light, deutan) and 7.7 (dark). Dark VUS~on-surface is 9.8. The test never checks the ClinVar scale, which includes `clinvar-conflicting` and `on-surface`. Fix: add a `clinvar` scale to `SCALES` and retune `clinvar-conflicting` until it passes.
4. **The protein `other` mark fails 3:1** (`shared/utils/protein-utils.ts:71`). `#999999` is 2.85:1 on white (2.61:1 on the grey-lighten-4 legend), and conflicting records now land there too. Fix: `#8A8A8A` gives 3.45:1 and stays ΔE 17 from VUS.
5. **Strength colours are duplicated** (`AcmgClassificationPanel.vue:226-232`). It keeps its own copy of `STRENGTH_COLORS`. Fix: import `ACMG_STRENGTH_COLORS` (−7 lines).
6. **The details consequence chip uses Material `grey`** (`VariantDetailsPanel.vue:541`). Its own SO-term→colour map also bypasses `IMPACT_COLORS`. Fix: `return 'muted'`, or `getImpactColor(variant.consequence)`, since `consequence` is the impact level.

**Nice to have**
7. **3D view has no `other` chip**, so conflicting records can no longer be shown there (before, they were wrongly shown as P) (`ProteinStructure3DPanel.vue:31-35`).
8. **Pre-mount theme follows only the OS** (`main/index.ts:95`, `index.html`). A user who chose "light" on a dark OS sees a dark window and splash until mount. The comment's "unless the app chose light" holds only after mount, so reword it.

Verdict: fix 1 first; 2–4 are cheap and belong in this PR (they are the PR's own CVD/contrast claim).
Lean: −7 lines possible (5).
Not checked: I ran no tests or app (read-only). The visual dark/light check, `make typecheck`/`make test` and the perf/UI gates are still needed.
