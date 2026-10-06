#!/usr/bin/env bash
# Auto-generated script to sync VarLens audited issues to GitHub Issues via gh CLI
set -euo pipefail

TARGET_ID="${1:-all}"

create_issue() {
  local id="$1"
  local title="$2"
  local labels="$3"
  local file="$4"
  if [[ "$TARGET_ID" != "all" && "$TARGET_ID" != "$id" ]]; then
    return 0
  fi
  echo "Creating GitHub issue for [$id]: $title..."
  gh issue create --title "[$id] $title" --label "$labels" --body-file "$file"
}

create_issue "DATA-01" "Orphaned variants and transcripts on failed import rollback due to foreign_keys=OFF" "data-integrity,database,sqlite,bug" ".planning/issues/001-data-01-foreign-keys-rollback-orphans.md"
create_issue "DATA-02" "Destructive case deletion before validating replacement file existence and format" "data-integrity,import,safety,bug" ".planning/issues/002-data-02-destructive-case-overwrite-validation.md"
create_issue "DATA-03" "Multi-file import frequency decrement erases shared counts for pre-existing cases" "data-integrity,frequencies,import,bug" ".planning/issues/003-data-03-multifile-import-frequency-decrement.md"
create_issue "DATA-04" "Ref-homozygous 0/0 structural variants and gVCF <NON_REF>/<*> symbolic alleles imported as false carriers" "data-integrity,vcf,sv,clinical-safety,bug" ".planning/issues/004-data-04-ref-hom-sv-gvcf-symbolic-carrier-filter.md"
create_issue "DATA-05" "Panel interval filter SQL column ambiguity and point-in-interval SV span miss" "data-integrity,filtering,database,parity,bug" ".planning/issues/005-data-05-panel-interval-sql-ambiguity-and-span-overlap.md"
create_issue "DATA-06" "Stale worker encryption keys and broken worker pool queries following database rekey" "security,encryption,database,workers,bug" ".planning/issues/006-data-06-rekey-encryption-worker-pool-sync.md"
create_issue "UI-01" "Async race condition in useTranscripts causes stale transcript display on rapid selection" "ui-ux,renderer,concurrency,clinical-safety,bug" ".planning/issues/007-ui-01-use-transcripts-async-race-condition.md"
create_issue "UI-02" "Workspace/database switch state leak in kept-alive views and singleton carrier cache" "ui-ux,data-integrity,privacy,renderer,bug" ".planning/issues/008-ui-02-workspace-switch-carrier-and-view-state-leak.md"
create_issue "UI-03" "Cohort pagination drops _count_needed flag causing redundant full-table COUNT(*) queries" "performance,ui-ux,cohort,renderer,bug" ".planning/issues/009-ui-03-cohort-pagination-drops-count-needed.md"
create_issue "UI-04" "Case comment cache invalidation missing when cases are deleted" "ui-ux,cache,renderer,tech-debt" ".planning/issues/010-ui-04-case-comment-cache-invalidation-on-delete.md"
create_issue "PERF-01" "Unindexed temporary table in panel interval filter causes O(N*M) table scans" "performance,database,sqlite,filtering" ".planning/issues/011-perf-01-unindexed-panel-intervals-temp-table.md"
create_issue "PERF-02" "Unbounded batch accumulation and synchronous JSON stream parsing during import" "performance,import,memory,hardening" ".planning/issues/012-perf-02-import-batch-memory-byte-bounds.md"
create_issue "ARCH-01" "Source file size exceeding 600-line LLM sustainability limit" "architecture,dx,refactor,tech-debt" ".planning/issues/013-arch-01-oversized-source-files-modular-decomposition.md"
create_issue "ARCH-02" "PostgreSQL vs SQLite query parity gaps in clinical filters and type handling" "parity,data-integrity,filtering,web,bug" ".planning/issues/014-arch-02-postgres-sqlite-query-parity-null-and-overlap.md"
create_issue "DX-01" "ESLint ignore pattern missing AI analysis directories (.understand-anything, .ua)" "dx,ci,tooling" ".planning/issues/015-dx-01-eslint-ignore-knowledge-graph-artifacts.md"
