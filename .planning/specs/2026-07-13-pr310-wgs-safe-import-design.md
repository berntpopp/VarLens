# PR310 WGS-Safe Import Hardening Design

## Goal

Close the final import denial-of-service and atomicity blockers without reintroducing the PostgreSQL GIAB WGS memory failure or rejecting legitimate large cohorts.

## Parser budgets

JSON format detection streams keys without retaining an unbounded key array. Independent budgets cover token count, nesting depth, top-level key count, key bytes, and individual key length before format selection.

VCF production paths resolve the selected sample column once from the header and scan only that column on each data row. Headers accept cohorts above 10,000 samples but use a 100,000-sample token budget and a scanner rather than an unbounded split. The legacy all-samples row API has the same explicit compatibility limit. FORMAT cardinality remains bounded per sample, while cohort width does not multiply FORMAT allocation.

Multi-allelic mapping groups annotations by allele in one pass, maps only alleles carried by the selected sample for non-structural records, and rejects aggregate annotation-match and expansion-work budgets before multiplicative allocation. BED diagnostics include only a bounded preview and the original line length.

Once VCF structure is established, gzip protection relies on absolute decompressed-byte, header-byte, line-length, and parser-work limits. A fixed compression-ratio cutoff is not applied to valid cohort VCFs because legitimate repeated genotype columns can exceed it.

## PostgreSQL provisional visibility

A WGS file never remains inside one transaction across all batches. Migration 0014 renames the physical case and variant tables to `cases_all` and `variants_all`, then exposes ready-only `cases` and `variants` views. Existing read repositories therefore share one visibility boundary: provisional cases and their committed variants do not appear in case lists, aggregates, cohort queries, annotations, or variant reads.

The import worker reserves a unique case name in `cases_all` with `import_status = 'importing'`. Each bounded mapped batch is copied directly to `variants_all` and its extension tables in an independent transaction. The case stores the maximum pre-file variant ID as a durable watermark; a failed append deletes only IDs above that watermark in 10,000-row transactions. A new failed case is deleted after its rows drain, while an existing case returns to `ready`. Startup recovery applies the same bounded cleanup to interrupted provisional cases.

A schema-scoped PostgreSQL advisory lock is held by the import connection before recovery and for the full operation. This prevents another Electron/web/process worker from reclaiming a live import. Cancellation is checked between every committed batch and before the final transaction.

The final synchronous transaction writes provenance, refreshes the authoritative count/frequency/cohort-summary state, flips the case to `ready`, and commits atomically. It performs no WGS-scale variant copy or duplicate generated-column computation; PostgreSQL MVCC keeps the previous ready snapshot visible until every derived structure and the case publish together. If the final `COMMIT` result is ambiguous, the worker never runs destructive cleanup: either PostgreSQL committed the ready case, or the still-hidden import is reclaimed idempotently by the next advisory-lock owner.

The public `cases` and `variants` names remain automatically updatable views. Ordinary lifecycle INSERT/UPDATE/DELETE operations therefore retain their existing contracts; import-only code addresses the hidden physical tables explicitly.

## SQLite append isolation and cancellation

Additional files use a dedicated SQLite connection opened from the database path and encryption key. `BEGIN IMMEDIATE` is held only on that connection while bounded batches are parsed and inserted. Unrelated main-connection writes can no longer join or be rolled back by the append transaction. Cancellation is represented by an `AbortSignal`, checked before rows, flushes, and commit; cancellation rolls back the isolated connection.

The IPC layer keeps a cancellation operation reachable for the full single- or multi-file lifetime. Nested first-file imports restore the enclosing cancellation owner when they finish. PostgreSQL cancellation reaches its worker client; SQLite cancellation both cancels the first-file worker and aborts append parsing.

## Acceptance

- A late PostgreSQL VCF failure after committed production batches leaves no visible case or variants.
- Consecutive WGS batches contain a commit boundary and cancellation checkpoint.
- A failed second PostgreSQL file leaves the first file intact and removes only IDs above its durable watermark.
- Ready-only views hide provisional rows from raw case and variant aggregate paths.
- A second PostgreSQL process cannot recover a live import because the schema advisory lock fails closed.
- Ordinary writes through the ready-only views remain functional, and no generated column is supplied by the COPY path.
- SQLite append cancellation rolls back the current file and the main database connection is never inside the append transaction.
- Multi-file cancellation remains reachable through `cancelImport` on both backends.
- Parser regression tests cover large valid cohorts and adversarial key, annotation, ALT/sample, FORMAT, gzip, and BED inputs.
