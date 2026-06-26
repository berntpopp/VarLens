import { describe, expect, it, vi } from 'vitest'

import { PostgresPublicAnnotationRepository } from '../../../src/main/storage/postgres/PostgresPublicAnnotationRepository'

function poolWithRows(rows: Array<{ rows: Record<string, unknown>[] }>) {
  return {
    query: vi.fn(async () => {
      const next = rows.shift()
      if (next === undefined) throw new Error('unexpected query')
      return next
    })
  }
}

describe('PostgresPublicAnnotationRepository', () => {
  it('returns empty references when the public snapshot tables are not synced yet', async () => {
    const pool = poolWithRows([{ rows: [{ exists: false }] }])
    const repository = new PostgresPublicAnnotationRepository(pool as never)

    await expect(
      repository.getReferencesForVariant({ chr: '1', pos: 12345, ref: 'A', alt: 'G' })
    ).resolves.toStrictEqual({ snapshots: [], variantRecords: [] })

    expect(pool.query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'SELECT to_regclass($1) IS NOT NULL AS exists',
        values: ['public.public_annotation_snapshots']
      })
    )
  })

  it('returns public snapshot summaries from the IAC sync tables', async () => {
    const pool = poolWithRows([
      { rows: [{ exists: true }] },
      { rows: [{ exists: true }] },
      {
        rows: [
          {
            snapshot_id: 'snapshot-2026-06-22-aaaaaaaaaaaa',
            bundle_id: 'bundle-2026-06-22-aaaaaaaaaaaa',
            genome_build: 'GRCh38',
            mapping_version: 'public-snapshot-map-v1',
            content_hash: 'sha256:' + 'a'.repeat(64),
            manifest_checksum: 'sha256:' + 'b'.repeat(64),
            license_matrix_checksum: 'sha256:' + 'c'.repeat(64),
            public_file_count: '3',
            private_case_data: false,
            ingested_at: '2026-06-22T12:00:00.000Z'
          }
        ]
      },
      { rows: [{ exists: false }] }
    ])
    const repository = new PostgresPublicAnnotationRepository(pool as never)

    const refs = await repository.getReferencesForVariant({
      chr: '1',
      pos: 12345,
      ref: 'A',
      alt: 'G'
    })

    expect(refs.snapshots).toStrictEqual([
      expect.objectContaining({
        snapshotId: 'snapshot-2026-06-22-aaaaaaaaaaaa',
        bundleId: 'bundle-2026-06-22-aaaaaaaaaaaa',
        genomeBuild: 'GRCh38',
        mappingVersion: 'public-snapshot-map-v1',
        publicFileCount: 3,
        privateCaseData: false
      })
    ])
    expect(refs.variantRecords).toStrictEqual([])
  })

  it('uses optional normalized variant records when the table exists', async () => {
    const pool = poolWithRows([
      { rows: [{ exists: true }] },
      { rows: [{ exists: true }] },
      {
        rows: [
          {
            snapshot_id: 'snapshot-2026-06-22-aaaaaaaaaaaa',
            bundle_id: null,
            genome_build: 'GRCh38',
            mapping_version: 'public-snapshot-map-v1',
            content_hash: 'sha256:' + 'a'.repeat(64),
            manifest_checksum: 'sha256:' + 'b'.repeat(64),
            license_matrix_checksum: 'sha256:' + 'c'.repeat(64),
            public_file_count: 1,
            private_case_data: false,
            ingested_at: null
          }
        ]
      },
      { rows: [{ exists: true }] },
      {
        rows: [
          { column_name: 'chr' },
          { column_name: 'pos' },
          { column_name: 'ref' },
          { column_name: 'alt' },
          { column_name: 'snapshot_id' },
          { column_name: 'source_id' },
          { column_name: 'field_name' },
          { column_name: 'field_value' },
          { column_name: 'evidence_json' },
          { column_name: 'provenance_json' }
        ]
      },
      {
        rows: [
          {
            key_chr: '1',
            key_pos: '12345',
            key_ref: 'A',
            key_alt: 'G',
            snapshot_id: 'snapshot-2026-06-22-aaaaaaaaaaaa',
            source_id: 'clinvar',
            field_name: 'clinical_significance',
            field_value: 'pathogenic',
            evidence_json: { accession: 'VCV0001' },
            provenance_json: { source: 'clinvar' }
          }
        ]
      }
    ])
    const repository = new PostgresPublicAnnotationRepository(pool as never)

    const batch = await repository.getBatchReferences([
      { chr: '1', pos: 12345, ref: 'A', alt: 'G' }
    ])

    expect(batch['1:12345:A:G'].variantRecords).toStrictEqual([
      {
        snapshotId: 'snapshot-2026-06-22-aaaaaaaaaaaa',
        sourceId: 'clinvar',
        fieldName: 'clinical_significance',
        fieldValue: 'pathogenic',
        evidence: { accession: 'VCV0001' },
        provenance: { source: 'clinvar' }
      }
    ])
    expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining('UNNEST'), [
      ['1'],
      [12345],
      ['A'],
      ['G'],
      500
    ])
  })
})
