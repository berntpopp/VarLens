# PR307 ZIP Hardening Design

## Goal

Make ZIP password validation and flattened extraction fail closed without exposing passwords or allowing unbounded synchronous decompression in Electron's main process.

## Password classification

`ZipExtractor.testPassword` performs one exhaustive pass over every non-directory entry. It records whether at least one encrypted entry exists and whether any encrypted entry explicitly rejected the supplied password. A wrong-password error does not end the pass; any later CRC, decompression, parsing, or other non-password error throws as archive corruption. The final result is `true` only when at least one encrypted entry exists and every encrypted entry decrypted successfully. A valid unencrypted archive therefore returns `false`.

The method never includes the supplied password in logs or constructed errors. Tests spy on the structured logger with a sentinel password to lock this boundary.

## Resource bounds

Password validation checks each entry's declared uncompressed size before decoding and checks the returned buffer size afterward. It also tracks a cumulative uncompressed-byte budget. Limits are constructor-injectable for deterministic small-fixture tests, while production uses ZIP-specific conservative defaults. PR310's active limits are not imported because they exist only as uncommitted work in another worktree and target streamed VCF/BED input rather than synchronous ZIP materialization.

## Extraction preflight

Before writing any file, extraction preflights all importable candidates (`.json`, `.gz`, and `.json.gz`). It rejects unsafe paths and case-insensitive collisions of flattened basenames. Any preflight error returns no extracted files and performs no writes, allowing the batch-import boundary to surface one fail-closed archive error and clean its temporary directory.

## Verification

Real ZIP fixtures cover exhaustive password classification, validation limits, duplicate basenames, zero writes, cleanup, and secret non-leakage. Focused Vitest, typecheck, lint, format-check, and agent-check must pass before commit.
