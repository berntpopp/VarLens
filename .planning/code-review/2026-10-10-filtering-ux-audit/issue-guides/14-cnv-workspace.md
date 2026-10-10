**TL;DR:** CNV/SV review needs interval context and per-carrier evidence alongside the existing type-specific tables.

**Priority:** P2 · Enhancement.

**Evidence:** Existing CNV/SV columns and extension details already expose useful call metrics. Gene-structure visualization receives a point without an interval end; no dedicated depth/BAF series view was found. Existing gene-structure axis text assumes GRCh38.

**Implementation guide:**

- Reuse the gene-structure view for a start/end interval band and affected exons, retaining point rendering for SNVs.
- Display build, coordinates, type, length and caller together. Verify the plot/reference assembly; show unknown or mismatched build explicitly.
- Prioritize relevant columns by variant type and expose per-carrier call metrics without representing summary data as per-sample evidence.
- Do not invent continuous depth/BAF tracks from scalar copy number. Such tracks require an actual series import/data contract.
- Keep alignment linking and IGV recovery in #93.

**Acceptance:** Synthetic deletion, duplication and breakpoint examples preserve identity and show correct interval/build context. Missing evidence is explicit. Narrow layouts retain essential metrics, and carrier selection updates the displayed evidence correctly.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

