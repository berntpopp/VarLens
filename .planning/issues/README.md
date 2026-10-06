# VarLens Repository Issues & Technical Debt Registry

This registry tracks verified architectural, data-integrity, concurrency, and performance issues across VarLens.
Every issue has been audited and independently reviewed by **Claude Code CLI using Claude Opus 5.5**, complete with root-cause analysis, reproduction traces, and proposed fixes.

## Issues by Priority

### P1 - Critical (Data Integrity, Clinical Safety & Security)

| ID | Title | Tags | Files | Spec |
|---|---|---|---|---|
| **DATA-01** | Orphaned variants and transcripts on failed import rollback due to foreign_keys=OFF | `data-integrity` `database` `sqlite` `bug` | `src/main/workers/worker-db.ts` | [001-data-01-foreign-keys-rollback-orphans.md](./001-data-01-foreign-keys-rollback-orphans.md) |
| **DATA-02** | Destructive case deletion before validating replacement file existence and format | `data-integrity` `import` `safety` `bug` | `src/main/workers/import-worker.ts` | [002-data-02-destructive-case-overwrite-validation.md](./002-data-02-destructive-case-overwrite-validation.md) |
| **DATA-03** | Multi-file import frequency decrement erases shared counts for pre-existing cases | `data-integrity` `frequencies` `import` `bug` | `src/main/ipc/handlers/import-logic.ts` | [003-data-03-multifile-import-frequency-decrement.md](./003-data-03-multifile-import-frequency-decrement.md) |
| **DATA-04** | Ref-homozygous 0/0 structural variants and gVCF <NON_REF>/<*> symbolic alleles imported as false carriers | `data-integrity` `vcf` `sv` `clinical-safety` `bug` | `src/main/import/vcf/VcfMapper.ts` | [004-data-04-ref-hom-sv-gvcf-symbolic-carrier-filter.md](./004-data-04-ref-hom-sv-gvcf-symbolic-carrier-filter.md) |
| **DATA-05** | Panel interval filter SQL column ambiguity and point-in-interval SV span miss | `data-integrity` `filtering` `database` `parity` `bug` | `src/main/database/VariantFilterBuilder.ts` | [005-data-05-panel-interval-sql-ambiguity-and-span-overlap.md](./005-data-05-panel-interval-sql-ambiguity-and-span-overlap.md) |
| **DATA-06** | Stale worker encryption keys and broken worker pool queries following database rekey | `security` `encryption` `database` `workers` `bug` | `src/main/database/DatabaseService.ts` | [006-data-06-rekey-encryption-worker-pool-sync.md](./006-data-06-rekey-encryption-worker-pool-sync.md) |
| **UI-02** | Workspace/database switch state leak in kept-alive views and singleton carrier cache | `ui-ux` `data-integrity` `privacy` `renderer` `bug` | `src/renderer/src/composables/useAppState.ts` | [008-ui-02-workspace-switch-carrier-and-view-state-leak.md](./008-ui-02-workspace-switch-carrier-and-view-state-leak.md) |
| **ARCH-02** | PostgreSQL vs SQLite query parity gaps in clinical filters and type handling | `parity` `data-integrity` `filtering` `web` `bug` | `src/main/storage/postgres/postgres-variant-clinical-filter-sql.ts` | [014-arch-02-postgres-sqlite-query-parity-null-and-overlap.md](./014-arch-02-postgres-sqlite-query-parity-null-and-overlap.md) |

### P2 - High (Significant User Impact / Performance Regressions)

| ID | Title | Tags | Files | Spec |
|---|---|---|---|---|
| **UI-01** | Async race condition in useTranscripts causes stale transcript display on rapid selection | `ui-ux` `renderer` `concurrency` `clinical-safety` `bug` | `src/renderer/src/composables/useTranscripts.ts` | [007-ui-01-use-transcripts-async-race-condition.md](./007-ui-01-use-transcripts-async-race-condition.md) |
| **UI-03** | Cohort pagination drops _count_needed flag causing redundant full-table COUNT(*) queries | `performance` `ui-ux` `cohort` `renderer` `bug` | `src/renderer/src/composables/useCohortData.ts` | [009-ui-03-cohort-pagination-drops-count-needed.md](./009-ui-03-cohort-pagination-drops-count-needed.md) |
| **PERF-01** | Unindexed temporary table in panel interval filter causes O(N*M) table scans | `performance` `database` `sqlite` `filtering` | `src/main/database/VariantFilterBuilder.ts` | [011-perf-01-unindexed-panel-intervals-temp-table.md](./011-perf-01-unindexed-panel-intervals-temp-table.md) |

### P3 - Medium (Hardening, Architecture Hygiene & Tooling)

| ID | Title | Tags | Files | Spec |
|---|---|---|---|---|
| **UI-04** | Case comment cache invalidation missing when cases are deleted | `ui-ux` `cache` `renderer` `tech-debt` | `src/renderer/src/composables/useCaseComments.ts` | [010-ui-04-case-comment-cache-invalidation-on-delete.md](./010-ui-04-case-comment-cache-invalidation-on-delete.md) |
| **PERF-02** | Unbounded batch accumulation and synchronous JSON stream parsing during import | `performance` `import` `memory` `hardening` | `src/main/import/transforms/BatchAccumulator.ts` | [012-perf-02-import-batch-memory-byte-bounds.md](./012-perf-02-import-batch-memory-byte-bounds.md) |
| **ARCH-01** | Source file size exceeding 600-line LLM sustainability limit | `architecture` `dx` `refactor` `tech-debt` | `src/main/database/VariantFilterBuilder.ts` | [013-arch-01-oversized-source-files-modular-decomposition.md](./013-arch-01-oversized-source-files-modular-decomposition.md) |
| **DX-01** | ESLint ignore pattern missing AI analysis directories (.understand-anything, .ua) | `dx` `ci` `tooling` | `eslint.config.mjs` | [015-dx-01-eslint-ignore-knowledge-graph-artifacts.md](./015-dx-01-eslint-ignore-knowledge-graph-artifacts.md) |

## Tag Index

- **`architecture`** (1): [ARCH-01](./013-arch-01-oversized-source-files-modular-decomposition.md)
- **`bug`** (10): [DATA-01](./001-data-01-foreign-keys-rollback-orphans.md), [DATA-02](./002-data-02-destructive-case-overwrite-validation.md), [DATA-03](./003-data-03-multifile-import-frequency-decrement.md), [DATA-04](./004-data-04-ref-hom-sv-gvcf-symbolic-carrier-filter.md), [DATA-05](./005-data-05-panel-interval-sql-ambiguity-and-span-overlap.md), [DATA-06](./006-data-06-rekey-encryption-worker-pool-sync.md), [UI-01](./007-ui-01-use-transcripts-async-race-condition.md), [UI-02](./008-ui-02-workspace-switch-carrier-and-view-state-leak.md), [UI-03](./009-ui-03-cohort-pagination-drops-count-needed.md), [ARCH-02](./014-arch-02-postgres-sqlite-query-parity-null-and-overlap.md)
- **`cache`** (1): [UI-04](./010-ui-04-case-comment-cache-invalidation-on-delete.md)
- **`ci`** (1): [DX-01](./015-dx-01-eslint-ignore-knowledge-graph-artifacts.md)
- **`clinical-safety`** (2): [DATA-04](./004-data-04-ref-hom-sv-gvcf-symbolic-carrier-filter.md), [UI-01](./007-ui-01-use-transcripts-async-race-condition.md)
- **`cohort`** (1): [UI-03](./009-ui-03-cohort-pagination-drops-count-needed.md)
- **`concurrency`** (1): [UI-01](./007-ui-01-use-transcripts-async-race-condition.md)
- **`data-integrity`** (7): [DATA-01](./001-data-01-foreign-keys-rollback-orphans.md), [DATA-02](./002-data-02-destructive-case-overwrite-validation.md), [DATA-03](./003-data-03-multifile-import-frequency-decrement.md), [DATA-04](./004-data-04-ref-hom-sv-gvcf-symbolic-carrier-filter.md), [DATA-05](./005-data-05-panel-interval-sql-ambiguity-and-span-overlap.md), [UI-02](./008-ui-02-workspace-switch-carrier-and-view-state-leak.md), [ARCH-02](./014-arch-02-postgres-sqlite-query-parity-null-and-overlap.md)
- **`database`** (4): [DATA-01](./001-data-01-foreign-keys-rollback-orphans.md), [DATA-05](./005-data-05-panel-interval-sql-ambiguity-and-span-overlap.md), [DATA-06](./006-data-06-rekey-encryption-worker-pool-sync.md), [PERF-01](./011-perf-01-unindexed-panel-intervals-temp-table.md)
- **`dx`** (2): [ARCH-01](./013-arch-01-oversized-source-files-modular-decomposition.md), [DX-01](./015-dx-01-eslint-ignore-knowledge-graph-artifacts.md)
- **`encryption`** (1): [DATA-06](./006-data-06-rekey-encryption-worker-pool-sync.md)
- **`filtering`** (3): [DATA-05](./005-data-05-panel-interval-sql-ambiguity-and-span-overlap.md), [PERF-01](./011-perf-01-unindexed-panel-intervals-temp-table.md), [ARCH-02](./014-arch-02-postgres-sqlite-query-parity-null-and-overlap.md)
- **`frequencies`** (1): [DATA-03](./003-data-03-multifile-import-frequency-decrement.md)
- **`hardening`** (1): [PERF-02](./012-perf-02-import-batch-memory-byte-bounds.md)
- **`import`** (3): [DATA-02](./002-data-02-destructive-case-overwrite-validation.md), [DATA-03](./003-data-03-multifile-import-frequency-decrement.md), [PERF-02](./012-perf-02-import-batch-memory-byte-bounds.md)
- **`memory`** (1): [PERF-02](./012-perf-02-import-batch-memory-byte-bounds.md)
- **`parity`** (2): [DATA-05](./005-data-05-panel-interval-sql-ambiguity-and-span-overlap.md), [ARCH-02](./014-arch-02-postgres-sqlite-query-parity-null-and-overlap.md)
- **`performance`** (3): [UI-03](./009-ui-03-cohort-pagination-drops-count-needed.md), [PERF-01](./011-perf-01-unindexed-panel-intervals-temp-table.md), [PERF-02](./012-perf-02-import-batch-memory-byte-bounds.md)
- **`privacy`** (1): [UI-02](./008-ui-02-workspace-switch-carrier-and-view-state-leak.md)
- **`refactor`** (1): [ARCH-01](./013-arch-01-oversized-source-files-modular-decomposition.md)
- **`renderer`** (4): [UI-01](./007-ui-01-use-transcripts-async-race-condition.md), [UI-02](./008-ui-02-workspace-switch-carrier-and-view-state-leak.md), [UI-03](./009-ui-03-cohort-pagination-drops-count-needed.md), [UI-04](./010-ui-04-case-comment-cache-invalidation-on-delete.md)
- **`safety`** (1): [DATA-02](./002-data-02-destructive-case-overwrite-validation.md)
- **`security`** (1): [DATA-06](./006-data-06-rekey-encryption-worker-pool-sync.md)
- **`sqlite`** (2): [DATA-01](./001-data-01-foreign-keys-rollback-orphans.md), [PERF-01](./011-perf-01-unindexed-panel-intervals-temp-table.md)
- **`sv`** (1): [DATA-04](./004-data-04-ref-hom-sv-gvcf-symbolic-carrier-filter.md)
- **`tech-debt`** (2): [UI-04](./010-ui-04-case-comment-cache-invalidation-on-delete.md), [ARCH-01](./013-arch-01-oversized-source-files-modular-decomposition.md)
- **`tooling`** (1): [DX-01](./015-dx-01-eslint-ignore-knowledge-graph-artifacts.md)
- **`ui-ux`** (4): [UI-01](./007-ui-01-use-transcripts-async-race-condition.md), [UI-02](./008-ui-02-workspace-switch-carrier-and-view-state-leak.md), [UI-03](./009-ui-03-cohort-pagination-drops-count-needed.md), [UI-04](./010-ui-04-case-comment-cache-invalidation-on-delete.md)
- **`vcf`** (1): [DATA-04](./004-data-04-ref-hom-sv-gvcf-symbolic-carrier-filter.md)
- **`web`** (1): [ARCH-02](./014-arch-02-postgres-sqlite-query-parity-null-and-overlap.md)
- **`workers`** (1): [DATA-06](./006-data-06-rekey-encryption-worker-pool-sync.md)

## GitHub Issue Synchronization

To file these issues to GitHub repository `berntpopp/VarLens`, use the automated sync helper:
```bash
chmod +x scripts/sync-github-issues.sh
./scripts/sync-github-issues.sh [optional-issue-id]
```
