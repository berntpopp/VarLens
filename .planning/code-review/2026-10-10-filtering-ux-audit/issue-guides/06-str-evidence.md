**TL;DR:** A known STR disease locus is being presented as a ClinVar pathogenic/likely pathogenic assertion even when no ClinVar annotation exists.

**Priority:** P1 · Bug.

**Evidence:** `src/main/services/scoring/score-str.ts` assigns a 0.9 ClinVar component whenever `str_disease` is nonempty. The shared scorer makes it pin-eligible, and `RankScoreTooltip.vue` labels it “Pinned: ClinVar P/LP.” This includes normal or unknown STR status with `clinvar=null`.

**Implementation guide:**

- Use the existing `mapClinvarBoost(row.clinvar)` for the ClinVar component.
- Keep any intended disease-locus heuristic in the existing impact/pathogenicity components and label its source accurately.
- Review pin partitions and ranking snapshots as behavior changes; do not mechanically accept new snapshots.

**Acceptance:** Disease-present STRs with normal, unknown and pathologic status must never claim ClinVar evidence when the annotation is absent. Actual P/LP annotations retain their intended behavior. Cover shared scoring and the visible tooltip on both shortlist backends.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

