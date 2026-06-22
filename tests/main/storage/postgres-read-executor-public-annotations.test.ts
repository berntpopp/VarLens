import { describe, expect, it, vi } from 'vitest'

import { PostgresReadExecutor } from '../../../src/main/storage/postgres/PostgresReadExecutor'

function makeExecutor(overrides: Record<string, unknown>) {
  return new PostgresReadExecutor({
    casesQuery: {},
    availableBuilds: {},
    overview: {},
    export: {},
    cohort: {},
    tags: {},
    annotations: {},
    commentsMetrics: {},
    panels: {},
    filterPresets: {},
    shortlist: {},
    analysisGroups: {},
    audit: {},
    transcripts: {},
    caseMetadata: {},
    variants: {},
    ...overrides
  } as never)
}

describe('PostgresReadExecutor public annotation references', () => {
  it('adds public references to annotations:getForVariant when configured', async () => {
    const publicReferences = {
      snapshots: [
        {
          snapshotId: 'snapshot-2026-06-22-aaaaaaaaaaaa',
          bundleId: null,
          genomeBuild: 'GRCh38',
          mappingVersion: 'public-snapshot-map-v1',
          contentHash: 'sha256:' + 'a'.repeat(64),
          manifestChecksum: 'sha256:' + 'b'.repeat(64),
          licenseMatrixChecksum: 'sha256:' + 'c'.repeat(64),
          publicFileCount: 1,
          privateCaseData: false,
          ingestedAt: null
        }
      ],
      variantRecords: []
    }
    const getAnnotationsForVariant = vi.fn(async () => ({ global: null, perCase: null }))
    const getReferencesForVariant = vi.fn(async () => publicReferences)
    const executor = makeExecutor({
      annotations: { getAnnotationsForVariant },
      publicAnnotations: { getReferencesForVariant }
    })

    await expect(
      executor.execute({
        type: 'annotations:getForVariant',
        params: [7, { chr: '1', pos: 12345, ref: 'A', alt: 'G' }]
      })
    ).resolves.toStrictEqual({ global: null, perCase: null, publicReferences })
    expect(getReferencesForVariant).toHaveBeenCalledWith({
      chr: '1',
      pos: 12345,
      ref: 'A',
      alt: 'G'
    })
  })

  it('keeps the legacy shape when public annotations are not configured', async () => {
    const getAnnotationsForVariant = vi.fn(async () => ({ global: null, perCase: null }))
    const executor = makeExecutor({
      annotations: { getAnnotationsForVariant }
    })

    await expect(
      executor.execute({
        type: 'annotations:getForVariant',
        params: [7, { chr: '1', pos: 12345, ref: 'A', alt: 'G' }]
      })
    ).resolves.toStrictEqual({ global: null, perCase: null })
  })

  it('adds public references to annotations:batchGet per coordinate key', async () => {
    const privateAnnotations = {
      '1:12345:A:G': { global: null, perCase: null },
      '2:23456:C:T': { global: null, perCase: null }
    }
    const getBatch = vi.fn(async () => privateAnnotations)
    const getBatchReferences = vi.fn(async () => ({
      '1:12345:A:G': {
        snapshots: [],
        variantRecords: [
          {
            snapshotId: 'snapshot-2026-06-22-aaaaaaaaaaaa',
            sourceId: 'clinvar',
            fieldName: 'clinical_significance',
            fieldValue: 'pathogenic',
            evidence: null,
            provenance: null
          }
        ]
      }
    }))
    const executor = makeExecutor({
      annotations: { getBatch },
      publicAnnotations: { getBatchReferences }
    })

    await expect(
      executor.execute({
        type: 'annotations:batchGet',
        params: [
          7,
          [
            { chr: '1', pos: 12345, ref: 'A', alt: 'G' },
            { chr: '2', pos: 23456, ref: 'C', alt: 'T' }
          ]
        ]
      })
    ).resolves.toStrictEqual({
      '1:12345:A:G': {
        global: null,
        perCase: null,
        publicReferences: {
          snapshots: [],
          variantRecords: [
            {
              snapshotId: 'snapshot-2026-06-22-aaaaaaaaaaaa',
              sourceId: 'clinvar',
              fieldName: 'clinical_significance',
              fieldValue: 'pathogenic',
              evidence: null,
              provenance: null
            }
          ]
        }
      },
      '2:23456:C:T': {
        global: null,
        perCase: null,
        publicReferences: { snapshots: [], variantRecords: [] }
      }
    })
  })
})
