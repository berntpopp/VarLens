**TL;DR:** Improve the existing desktop IGV action's interval/build context and failure feedback as an early step.

**Evidence:** `src/renderer/src/components/ExternalLinksSection.vue` currently constructs a point locus (`chr:pos-pos`); connection failure is logged and the spinner stops without actionable recovery. CNV/SV calls already carry interval information.

**Implementation guide:** Carry a validated build and interval through the existing action, with breakpoint handling where a single interval is inappropriate. Show a visible connection failure and Retry/start-IGV guidance. Keep BAM/CRAM linking and embedded tracks as the larger scope already described here; a new viewer is unnecessary just to fix feedback.

**Acceptance:** Test a point variant, a deletion/duplication interval, unknown or mismatched build, and an unavailable listener. Failed navigation is visible and retryable; successful navigation uses the selected variant's intended locus. Use synthetic cases and do not assume scalar CNV metrics contain read-level tracks.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

