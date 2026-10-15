/**
 * Per-case saved analysis filter snapshot (#124): distinct from volatile
 * `localStorage` view memory (`varlens_case_view_state_v1`) and global filter
 * presets. Stored via `case_external_ids` under a reserved `_varlens_*` key so
 * Desktop (SQLite/PG) and Web (REST) share one transport without a migration,
 * and audited in `audit_log` on save, restore, and clear.
 */
import type { FilterState } from '../types/filters'

export const CASE_FILTER_SNAPSHOT_ID_TYPE = '_varlens_filter_snapshot'
export const CASE_FILTER_RESTORE_ID_TYPE = '_varlens_filter_restore'

export function isInternalCaseExternalIdType(idType: string): boolean {
  return idType.startsWith('_varlens_')
}

export interface CaseFilterSnapshotStamp {
  genome_build: string
  hpo_data_key: string
  variant_count: number
}

export interface CaseFilterSnapshotSortItem {
  key: string
  order: 'asc' | 'desc'
}

export interface CaseFilterSnapshotPayload {
  v: 1
  saved_at: number
  stamp: CaseFilterSnapshotStamp
  filters?: Partial<FilterState>
  searchQuery?: string
  sortBy?: CaseFilterSnapshotSortItem[]
  f?: Partial<FilterState>
  q?: string
  sort?: CaseFilterSnapshotSortItem[]
}

export function serializeCaseFilterSnapshot(payload: CaseFilterSnapshotPayload): string {
  return JSON.stringify(payload)
}

export function parseCaseFilterSnapshot(
  raw: string | null | undefined
): CaseFilterSnapshotPayload | null {
  if (raw == null || raw === '') return null
  try {
    const parsed = JSON.parse(raw) as Partial<CaseFilterSnapshotPayload>
    if (
      parsed == null ||
      typeof parsed !== 'object' ||
      parsed.v !== 1 ||
      typeof parsed.saved_at !== 'number' ||
      parsed.stamp == null ||
      typeof parsed.stamp !== 'object' ||
      typeof parsed.stamp.genome_build !== 'string' ||
      typeof parsed.stamp.hpo_data_key !== 'string' ||
      typeof parsed.stamp.variant_count !== 'number'
    ) {
      return null
    }
    return parsed as CaseFilterSnapshotPayload
  } catch {
    return null
  }
}

/**
 * Compare the saved snapshot's dataset/annotation stamp against the case's
 * current state so restoring explains if underlying data changed (#124).
 */
export function diffCaseFilterSnapshotStamps(
  saved: CaseFilterSnapshotStamp,
  current: CaseFilterSnapshotStamp
): string[] {
  const diffs: string[] = []
  if (saved.genome_build !== current.genome_build) {
    diffs.push(`Genome build changed (${saved.genome_build} -> ${current.genome_build})`)
  }
  if (saved.hpo_data_key !== current.hpo_data_key) {
    diffs.push(
      `HPO/phenotype index version changed (${saved.hpo_data_key || 'none'} -> ${current.hpo_data_key || 'none'})`
    )
  }
  if (saved.variant_count !== current.variant_count) {
    diffs.push(`Case variant count changed (${saved.variant_count} -> ${current.variant_count})`)
  }
  return diffs
}

export type CaseFilterAuditMethod =
  'filter_snapshot_save' | 'filter_snapshot_restore' | 'filter_snapshot_clear'

/**
 * Build a JSON string for `audit_log.new_value` using keys whitelisted in
 * `src/shared/audit/audit-contract.ts` (`method`, `genome_build`, `identifier`, `reason`).
 */
export function formatCaseFilterAuditPayload(
  method: CaseFilterAuditMethod,
  stamp?: Partial<CaseFilterSnapshotStamp> | null,
  reason?: string
): string {
  return JSON.stringify({
    method,
    genome_build: stamp?.genome_build ?? 'unknown',
    identifier: stamp?.hpo_data_key ?? 'none',
    reason: reason ?? `variant_count=${stamp?.variant_count ?? 0}`
  })
}
