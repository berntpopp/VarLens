# PR310 Final Blocker Design

## Goal

Close the two remaining import hardening blockers without rejecting supported high-sample-count VCFs or retaining a full BED object graph in Electron/web memory.

## Gzip resource control

The absolute decompressed-byte and line-length caps remain mandatory for every input. The ratio guard becomes format-aware rather than treating a compression ratio as proof of hostility. A small prefix inspector identifies VCF input and reads the `#CHROM` sample count without buffering data lines. VCF streams receive a bounded sample-aware ratio allowance because repeated genotype columns legitimately compress far beyond 100x; non-VCF JSON/BED retains the conservative default. Focused callers can configure the base ratio through the existing stream option, while a hard upper bound prevents the sample count from silently disabling the guard.

Acceptance is locked by a production-default stream test using a valid 500-sample VCF whose decompressed size exceeds the 64 MiB ratio floor, plus a many-short-line gzip bomb that is rejected before the absolute decompressed cap.

## BED persistence

BED parsing and persistence become a storage-owned operation. Desktop and web handlers pass only the authorized path, file ID, and malformed-row policy. PostgreSQL opens one transaction, consumes the shared bounded `readBedEntries` async iterable in fixed-size chunks, updates count/total-base metadata, and commits. SQLite streams into uniquely named bounded staging chunks, then performs a short transaction that atomically replaces the visible rows and metadata. A parse/insert failure leaves or rolls back to the prior region file.

The storage write contract therefore carries a path and policy rather than `entries[]`. No handler, executor task, or repository owns a million-entry array. PostgreSQL uses bounded `UNNEST` arrays per chunk; SQLite prepares and reuses one insert statement for bounded staging chunks and deletes the staging table after either success or failure.

## Security and errors

Desktop path authority stays at the IPC boundary; web upload references remain user-scoped and resolve to their staged server path before storage runs. Parsers retain safe-integer and decompressed-size validation. Transaction rollback is mandatory on malformed strict web rows, resource-limit failures, and database insert failures.

## Verification

Tests cover VCF high-ratio acceptance and bomb rejection, bounded chunk sizes, both backend transaction commit/rollback, desktop and web task shapes, path authority, type checking, lint, formatting, and agent-health gates.
