# Backlog batch 2 (2026-10-13)

Base: `feat/backlog-batch-2` = origin/main (v0.85.2) + PR #609 (audit correctness batch).
Six parallel lanes, merged `--no-ff` into this branch, then one `make preflight-full` and a ponytail review.

| Lane | Issues | Migration (SQLite / PG) |
|---|---|---|
| acmg | #567 override reason, #574 ACMG + comment in exports, #577 build in global annotation key | 52 / 0035 |
| info | #580 hpo_match, #596 source field names, #538 rest (info-key discovery), #556 rest (--minimal count) | 53 / 0036 if needed |
| sv | #573 cohort End/length, #539 rest (cohort intervals + carrier metrics), #93 IGV interval + failure feedback (partial) | — |
| filters | #568 explain empty results, #570 presets named by clinical question | 54 / 0037 |
| display | #576 build with HGVS/coords, #572 ClinVar shape cue, #201 ClinGen CSpec gene flag | — |
| proxy | #126 proxy via Electron `net.fetch` | — |

Deferred: #124, #569 (filters follow-up), #575 (decided with the auth gate, #295), #578 (manual SR/GPU check),
shortlist research (#597 #600 #583 #584 #581 #582 #149), allele identity (#586 #587), #125, #93 BAM, #50 somatic.
