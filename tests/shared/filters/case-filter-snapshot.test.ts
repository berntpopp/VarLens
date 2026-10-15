import { describe, expect, it } from 'vitest'
import {
  CASE_FILTER_RESTORE_ID_TYPE,
  CASE_FILTER_SNAPSHOT_ID_TYPE,
  diffCaseFilterSnapshotStamps,
  formatCaseFilterAuditPayload,
  isInternalCaseExternalIdType,
  parseCaseFilterSnapshot,
  serializeCaseFilterSnapshot,
  type CaseFilterSnapshotPayload,
  type CaseFilterSnapshotStamp
} from '../../../src/shared/filters/case-filter-snapshot'

describe('case-filter-snapshot', () => {
  it('identifies internal case external ID types', () => {
    expect(CASE_FILTER_SNAPSHOT_ID_TYPE).toBe('_varlens_filter_snapshot')
    expect(CASE_FILTER_RESTORE_ID_TYPE).toBe('_varlens_filter_restore')
    expect(isInternalCaseExternalIdType(CASE_FILTER_SNAPSHOT_ID_TYPE)).toBe(true)
    expect(isInternalCaseExternalIdType(CASE_FILTER_RESTORE_ID_TYPE)).toBe(true)
    expect(isInternalCaseExternalIdType('_varlens_custom')).toBe(true)
    expect(isInternalCaseExternalIdType('Lab ID')).toBe(false)
    expect(isInternalCaseExternalIdType('OMIM')).toBe(false)
  })

  it('round-trips serializeCaseFilterSnapshot and parseCaseFilterSnapshot', () => {
    const stamp: CaseFilterSnapshotStamp = {
      genome_build: 'GRCh38',
      hpo_data_key: 'hpo-2026-01',
      variant_count: 1234
    }
    const payload: CaseFilterSnapshotPayload = {
      v: 1,
      saved_at: 1700000000000,
      stamp,
      filters: {
        geneSymbol: 'BRCA1',
        maxInternalAf: 0.01,
        consequences: ['missense_variant']
      },
      searchQuery: 'BRCA1',
      sortBy: [{ key: 'cadd', order: 'desc' }]
    }
    const raw = serializeCaseFilterSnapshot(payload)
    const parsed = parseCaseFilterSnapshot(raw)
    expect(parsed).toEqual(payload)
  })

  it('returns null for invalid JSON or malformed snapshot payloads', () => {
    expect(parseCaseFilterSnapshot(null)).toBeNull()
    expect(parseCaseFilterSnapshot(undefined)).toBeNull()
    expect(parseCaseFilterSnapshot('')).toBeNull()
    expect(parseCaseFilterSnapshot('not-json')).toBeNull()
    expect(parseCaseFilterSnapshot(JSON.stringify({ v: 2 }))).toBeNull()
    expect(
      parseCaseFilterSnapshot(
        JSON.stringify({
          v: 1,
          saved_at: 123,
          stamp: { genome_build: 'GRCh38', hpo_data_key: 42, variant_count: 10 }
        })
      )
    ).toBeNull()
  })

  it('detects drift across genome_build, hpo_data_key, and variant_count', () => {
    const base: CaseFilterSnapshotStamp = {
      genome_build: 'GRCh37',
      hpo_data_key: 'hpo-v1',
      variant_count: 500
    }
    expect(diffCaseFilterSnapshotStamps(base, { ...base })).toEqual([])

    const drifted = diffCaseFilterSnapshotStamps(base, {
      genome_build: 'GRCh38',
      hpo_data_key: 'hpo-v2',
      variant_count: 520
    })
    expect(drifted).toEqual([
      'Genome build changed (GRCh37 -> GRCh38)',
      'HPO/phenotype index version changed (hpo-v1 -> hpo-v2)',
      'Case variant count changed (500 -> 520)'
    ])
  })

  it('formats audit log payload strings', () => {
    const stamp: CaseFilterSnapshotStamp = {
      genome_build: 'GRCh38',
      hpo_data_key: 'hpo-v1',
      variant_count: 100
    }
    const savePayload = JSON.parse(formatCaseFilterAuditPayload('filter_snapshot_save', stamp))
    expect(savePayload).toEqual({
      method: 'filter_snapshot_save',
      genome_build: 'GRCh38',
      identifier: 'hpo-v1',
      reason: 'variant_count=100'
    })

    const clearPayload = JSON.parse(
      formatCaseFilterAuditPayload('filter_snapshot_clear', null, 'snapshot_cleared')
    )
    expect(clearPayload).toEqual({
      method: 'filter_snapshot_clear',
      genome_build: 'unknown',
      identifier: 'none',
      reason: 'snapshot_cleared'
    })
  })
})
