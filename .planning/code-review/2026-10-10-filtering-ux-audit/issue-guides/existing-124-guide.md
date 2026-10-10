**TL;DR:** Save the applied analysis state, not merely the text currently being edited.

**Implementation guide:** Reuse existing URL/filter serialization. Capture case/cohort scope, genome build, variant type, committed DSL conditions, drawer/header filters, sort and relevant panel versions. Record available dataset/annotation version identifiers so a restored configuration does not imply unchanged evidence. Keep a reusable preset distinct from a complete analysis snapshot.

**Acceptance:** With unchanged data, save → edit → restore returns identical matching IDs and export scope. An invalid draft is never silently applied. Removed chips do not reappear after restoration. Missing fields/builds/panels and changed data versions are explained. Preserve quoted values, null semantics, preset divergence and backward compatibility.

This extends the existing issue's acceptance criteria; it does not establish regulatory compliance.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

