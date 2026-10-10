**TL;DR:** Clicking a carrier should open that exact variant in the correct case/type tab.

**Priority:** P2 · Bug.

**Evidence:** `CohortTable.vue` emits coordinates and alleles, but `views/CohortView.vue` discards them and builds a gene/cDNA search. Variant type is omitted, and the case commonly opens its default Shortlist tab. Missing annotations therefore lose the target; gene searches can broaden it.

**Implementation guide:**

- Carry exact identity and variant type through the existing navigation payload.
- Select the matching case tab and reveal/select the row after loading.
- Use typed identity filters, not transcript-dependent text search.
- If the target is unavailable or excluded, explain that state rather than silently landing on unrelated rows.

**Acceptance:** Click carriers for a variant without gene/cDNA, two alleles at one position, an SV and a CNV, including a variant outside Shortlist. Each opens the correct case and exact variant. Cover delayed loading and unavailable targets.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

