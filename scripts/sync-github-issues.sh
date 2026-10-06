#!/usr/bin/env bash
# Auto-generated script to sync VarLens audited issues to GitHub Issues via gh CLI
set -euo pipefail

TARGET_ID="${1:-all}"

# Ensure labels exist in repository
ensure_labels() {
  echo "Ensuring required labels exist..."
  local labels=(
    "P1-critical:d73a4a:Critical priority issue"
    "P2-high:e99695:High priority issue"
    "P3-medium:fbca04:Medium priority issue"
    "data-integrity:b60205:Data integrity or corruption risk"
    "database:0052cc:Database layer or schema"
    "sqlite:0052cc:SQLite engine or queries"
    "import:fbca04:File import pipeline"
    "safety:b60205:Clinical or operational safety"
    "frequencies:5319e7:Variant allele frequency calculations"
    "vcf:1d76db:VCF format parsing and processing"
    "sv:1d76db:Structural variants and CNVs"
    "clinical-safety:b60205:Clinical variant interpretation safety"
    "filtering:c2e0c6:Variant and cohort filtering"
    "parity:c5def5:Cross-backend SQLite/PostgreSQL parity"
    "security:ee0701:Security, encryption, credentials"
    "encryption:ee0701:SQLCipher encryption"
    "workers:bfdadc:Background worker threads"
    "ui-ux:f9d0c4:UI / UX and frontend"
    "renderer:f9d0c4:Electron renderer Vue components"
    "concurrency:d93f0b:Async concurrency and race conditions"
    "privacy:5319e7:Data privacy and isolation"
    "performance:0e8a16:Performance optimization"
    "cohort:006b75:Cohort view and analysis"
    "cache:fef2c0:In-memory caching and invalidation"
    "tech-debt:fbca04:Technical debt and maintainability"
    "memory:0e8a16:Memory consumption bounds"
    "hardening:bfdadc:System reliability and hardening"
    "architecture:0052cc:Architectural decomposition"
    "dx:0075ca:Developer experience and tooling"
    "refactor:fbca04:Refactoring and code cleanup"
    "web:1d76db:Web server and browser client"
    "ci:0075ca:CI/CD pipelines"
    "tooling:bfdadc:Build tooling and scripts"
  )

  for entry in "${labels[@]}"; do
    IFS=":" read -r name color desc <<< "$entry"
    gh label create "$name" --color "$color" --description "$desc" --force 2>/dev/null || true
  done
}

ensure_labels

create_issue() {
  local id="$1"
  local priority="$2"
  local title="$3"
  local labels="$4"
  local file="$5"

  if [[ "$TARGET_ID" != "all" && "$TARGET_ID" != "$id" ]]; then
    return 0
  fi

  local full_labels="${priority},${labels}"
  local full_title="[$id] $title"

  # Check if issue already exists
  local existing
  existing=$(gh issue list --search "in:title \"[$id]\"" --state all --json number --jq '.[0].number' 2>/dev/null || true)

  if [[ -n "$existing" ]]; then
    echo "Issue for [$id] already exists (#$existing). Skipping."
    return 0
  fi

  echo "Creating GitHub issue for [$id]: $title..."
  gh issue create --title "$full_title" --label "$full_labels" --body-file "$file"
}

create_issue "DATA-01" "P1-critical" "Orphaned variants and transcripts on failed import rollback due to foreign_keys=OFF" "data-integrity,database,sqlite,bug" ".planning/issues/001-data-01-foreign-keys-rollback-orphans.md"
create_issue "DATA-02" "P1-critical" "Destructive case deletion before validating replacement file existence and format" "data-integrity,import,safety,bug" ".planning/issues/002-data-02-destructive-case-overwrite-validation.md"
create_issue "DATA-03" "P1-critical" "Multi-file import frequency decrement erases shared counts for pre-existing cases" "data-integrity,frequencies,import,bug" ".planning/issues/003-data-03-multifile-import-frequency-decrement.md"
create_issue "DATA-04" "P1-critical" "Ref-homozygous 0/0 structural variants and gVCF <NON_REF>/<*> symbolic alleles imported as false carriers" "data-integrity,vcf,sv,clinical-safety,bug" ".planning/issues/004-data-04-ref-hom-sv-gvcf-symbolic-carrier-filter.md"
create_issue "DATA-05" "P1-critical" "Panel interval filter SQL column ambiguity and point-in-interval SV span miss" "data-integrity,filtering,database,parity,bug" ".planning/issues/005-data-05-panel-interval-sql-ambiguity-and-span-overlap.md"
create_issue "DATA-06" "P1-critical" "Stale worker encryption keys and broken worker pool queries following database rekey" "security,encryption,database,workers,bug" ".planning/issues/006-data-06-rekey-encryption-worker-pool-sync.md"
create_issue "UI-01" "P2-high" "Async race condition in useTranscripts causes stale transcript display on rapid selection" "ui-ux,renderer,concurrency,clinical-safety,bug" ".planning/issues/007-ui-01-use-transcripts-async-race-condition.md"
create_issue "UI-02" "P1-critical" "Workspace/database switch state leak in kept-alive views and singleton carrier cache" "ui-ux,data-integrity,privacy,renderer,bug" ".planning/issues/008-ui-02-workspace-switch-carrier-and-view-state-leak.md"
create_issue "UI-03" "P2-high" "Cohort pagination drops _count_needed flag causing redundant full-table COUNT(*) queries" "performance,ui-ux,cohort,renderer,bug" ".planning/issues/009-ui-03-cohort-pagination-drops-count-needed.md"
create_issue "UI-04" "P3-medium" "Case comment cache invalidation missing when cases are deleted" "ui-ux,cache,renderer,tech-debt" ".planning/issues/010-ui-04-case-comment-cache-invalidation-on-delete.md"
create_issue "PERF-01" "P2-high" "Unindexed temporary table in panel interval filter causes O(N*M) table scans" "performance,database,sqlite,filtering" ".planning/issues/011-perf-01-unindexed-panel-intervals-temp-table.md"
create_issue "PERF-02" "P3-medium" "Unbounded batch accumulation and synchronous JSON stream parsing during import" "performance,import,memory,hardening" ".planning/issues/012-perf-02-import-batch-memory-byte-bounds.md"
create_issue "ARCH-01" "P3-medium" "Source file size exceeding 600-line LLM sustainability limit" "architecture,dx,refactor,tech-debt" ".planning/issues/013-arch-01-oversized-source-files-modular-decomposition.md"
create_issue "ARCH-02" "P1-critical" "PostgreSQL vs SQLite query parity gaps in clinical filters and type handling" "parity,data-integrity,filtering,web,bug" ".planning/issues/014-arch-02-postgres-sqlite-query-parity-null-and-overlap.md"
create_issue "DX-01" "P3-medium" "ESLint ignore pattern missing AI analysis directories (.understand-anything, .ua)" "dx,ci,tooling" ".planning/issues/015-dx-01-eslint-ignore-knowledge-graph-artifacts.md"
