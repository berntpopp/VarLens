# PR309 Transcript Correctness Follow-up Design

## Goal

Close the five adversarial review findings while preserving the canonical model: `consequence` is an IMPACT enum and `func` is a Sequence Ontology term.

## Design

- Extend the shared transcript semantic canonicalizer so an IMPACT found in either input field is retained, an SO term is retained in `func`, and invalid/nonrecoverable impact becomes `null`.
- In the VCF annotation parser, select the highest-ranked annotation independently for each transcript before constructing transcript rows. Parent selection and per-transcript selection use the same format-specific ranking.
- In SQLite and PostgreSQL migrations, preserve the legacy SO term in `func` and recover impact only for the selected row whose transcript matches the parent variant and whose parent consequence is a valid IMPACT enum.
- Transcript switches atomically write every denormalized field, including `consequence = null` when impact is unavailable. This prevents rows assembled from two different selected transcripts.
- Columnar JSON mapping validates IMPACT through the shared canonicalizer. Renderer merge rows expose DB `consequence` as their sortable impact.

## Error handling and compatibility

Unknown impact values fail closed to `null`; they are never copied into `consequence`. Existing SO terms are preserved when possible. Both storage engines implement identical migration and switch semantics inside existing transactions.

## Verification

Each finding receives a regression test that is observed failing before the implementation change. Focused import, migration, storage, and renderer suites run after each fix, followed by typecheck, agent-check, and the repository CI gate.
