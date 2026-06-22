import { describe, expect, test } from 'vitest'

import {
  assertPublicAnnotationSnapshotManifest,
  validatePublicAnnotationSnapshotManifest,
  type PublicAnnotationSnapshotManifest
} from '../../../src/shared/annotations/public-snapshot'

function validManifest(): PublicAnnotationSnapshotManifest {
  const contentHash = 'sha256:' + 'a'.repeat(64)
  return {
    schemaVersion: 'varlens.public-annotation-snapshot.v1',
    snapshotId: 'clinvar-2026-06-22-aaaaaaaaaaaa',
    createdAt: '2026-06-22T10:00:00.000Z',
    genomeBuild: 'GRCh38',
    mappingVersion: 'public-snapshot-map-v1',
    licenseGate: 'fail-closed',
    licenseMatrix: {
      matrixId: 'varlens_public_snapshot_policy',
      policyVersion: '2026-06-22',
      matrixChecksum: 'sha256:' + 'e'.repeat(64),
      generatedAt: '2026-06-22T09:00:00.000Z',
      entries: [
        {
          entryId: 'clinvar_significance_policy',
          sourceId: 'clinvar',
          fieldName: 'clinvar_significance',
          sourceUrl: 'https://example.org/clinvar-release',
          accession: 'clinvar-2026-06-01',
          licenseId: 'clinvar_public_domain',
          licenseUrl: 'https://example.org/clinvar-license',
          archivedTextChecksum: 'sha256:' + 'c'.repeat(64),
          redistributionClass: 'public_redistributable',
          clinicalUse: 'allowed',
          attribution: 'ClinVar, NCBI',
          derivativeInheritance: 'none',
          shareAlike: false,
          promotionEligibility: 'public_snapshot',
          reviewer: 'license-review',
          reviewedAt: '2026-06-22T09:30:00.000Z',
          evidenceChecksum: 'sha256:' + 'd'.repeat(64)
        }
      ]
    },
    mutableLatest: false,
    privacy: {
      noPrivateData: true,
      noCaseLinkedData: true,
      noPrivateQueryHistory: true
    },
    sources: [
      {
        sourceId: 'clinvar',
        name: 'ClinVar',
        version: '2026-06-01',
        retrievedAt: '2026-06-02T00:00:00.000Z',
        license: {
          licenseId: 'clinvar_public_domain',
          name: 'ClinVar public domain notice',
          url: 'https://example.org/clinvar-license',
          status: 'allowed',
          redistribution: 'allowed',
          redistributionClass: 'public_redistributable',
          clinicalUse: 'allowed',
          derivativeInheritance: 'none',
          shareAlike: false,
          archivedTextChecksum: 'sha256:' + 'c'.repeat(64),
          attribution: 'ClinVar, NCBI'
        },
        provenanceUrl: 'https://example.org/clinvar-provenance.json',
        checksum: 'sha256:' + 'a'.repeat(64)
      }
    ],
    fields: [
      {
        name: 'clinvar_significance',
        sourceId: 'clinvar',
        dataType: 'string',
        storageClass: 'public_reference_annotations',
        nullSemantics: 'missing when no ClinVar assertion exists for the variant',
        description: 'ClinVar clinical significance summary',
        promotionEligibility: 'public_snapshot',
        licenseStatus: 'allowed'
      }
    ],
    rowCounts: {
      variants: 1000
    },
    manifestChecksum: 'sha256:' + 'b'.repeat(64),
    contentHash,
    releaseReview: {
      reviewer: 'license-review',
      reviewedAt: '2026-06-22T10:30:00.000Z',
      evidenceChecksum: 'sha256:' + 'd'.repeat(64)
    }
  }
}

describe('public annotation snapshot manifest contract', () => {
  test('accepts immutable license-cleared public-reference manifests', () => {
    const result = validatePublicAnnotationSnapshotManifest(validManifest())

    expect(result).toMatchObject({ ok: true, errors: [] })
    expect(result.manifest?.snapshotId).toBe('clinvar-2026-06-22-aaaaaaaaaaaa')
  })

  test('fails closed for restricted or unknown source licenses', () => {
    const manifest = validManifest()
    manifest.sources[0].license.status = 'unknown'

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('source license status must be allowed')
  })

  test('fails closed when redistribution is not explicitly allowed', () => {
    const manifest = validManifest()
    manifest.sources[0].license.redistribution = 'unknown'

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('source redistribution must be allowed')
  })

  test('fails closed when redistribution class or clinical use are not public', () => {
    const manifest = validManifest()
    manifest.sources[0].license.redistributionClass = 'metadata_only'
    manifest.sources[0].license.clinicalUse = 'unknown'

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('source redistribution class must be public')
    expect(result.errors.join('\n')).toContain('source clinical use must be allowed')
  })

  test('fails closed for share-alike or restricted derivative inheritance', () => {
    const manifest = validManifest()
    manifest.sources[0].license.derivativeInheritance = 'share_alike'
    manifest.sources[0].license.shareAlike = true

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('source derivative inheritance')
    expect(result.errors.join('\n')).toContain('source share-alike must be false')
  })

  test.each(['latest', 'clinvar-latest', 'clinvar_latest', 'clinvar.latest', 'latest-clinvar', 'current'])(
    'rejects mutable snapshot id alias %s',
    (snapshotId) => {
      const manifest = { ...validManifest(), snapshotId }

      const result = validatePublicAnnotationSnapshotManifest(manifest)

      expect(result.ok).toBe(false)
      expect(result.errors.join('\n')).toContain('immutable release')
    }
  )

  test('rejects fields that look private or case-linked', () => {
    const manifest = validManifest()
    manifest.fields[0] = {
      ...manifest.fields[0],
      name: 'sample_vaf'
    }

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('field name looks private')
  })

  test('rejects private-looking field and row count names without separators', () => {
    const fieldManifest = validManifest()
    fieldManifest.fields[0] = {
      ...fieldManifest.fields[0],
      name: 'sampleid'
    }
    expect(validatePublicAnnotationSnapshotManifest(fieldManifest).errors.join('\n')).toContain(
      'field name looks private'
    )

    const rowCountManifest = validManifest()
    rowCountManifest.rowCounts = {
      caseid: 4
    }
    const rowCountResult = validatePublicAnnotationSnapshotManifest(rowCountManifest)
    expect(rowCountResult.ok).toBe(false)
    expect(rowCountResult.errors.join('\n')).toContain('rowCounts.<redacted>')
  })

  test('rejects field metadata that looks private or case-linked', () => {
    const manifest = validManifest()
    manifest.fields[0] = {
      ...manifest.fields[0],
      description: 'Derived from patient phenotype context'
    }

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('metadata looks private')
  })

  test('rejects fields that reference unknown sources', () => {
    const manifest = validManifest()
    manifest.fields[0] = {
      ...manifest.fields[0],
      sourceId: 'dbnsfp'
    }

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('field references unknown source')
  })

  test('rejects duplicate source IDs', () => {
    const manifest = validManifest()
    manifest.sources.push({ ...manifest.sources[0], version: 'different-version' })

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('source ID is duplicated')
  })

  test.each([
    ['dbnsfp', 'dbNSFP'],
    ['dbnsfp_cadd', 'dbNSFP derived CADD scores'],
    ['dbnsfp4', 'dbNSFP 4 derived scores'],
    ['caddphred', 'CADD PHRED score'],
    ['mimnumber', 'MIM number'],
    ['mendelian_catalog', 'Online Mendelian Inheritance in Man']
  ])('rejects spec-blocklisted source %s until field-level clearance exists', (sourceId, name) => {
    const manifest = validManifest()
    manifest.sources[0] = {
      ...manifest.sources[0],
      sourceId,
      name
    }
    manifest.fields[0] = {
      ...manifest.fields[0],
      sourceId
    }

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('source is blocked for public snapshots')
  })

  test('rejects blocklisted source URLs even when source IDs are neutral', () => {
    const manifest = validManifest()
    manifest.sources[0] = {
      ...manifest.sources[0],
      sourceId: 'reference_catalog',
      name: 'Reference catalog',
      license: {
        ...manifest.sources[0].license,
        url: 'https://omim.org/license'
      },
      provenanceUrl: 'https://omim.org/download/source.json'
    }
    manifest.fields[0] = {
      ...manifest.fields[0],
      sourceId: 'reference_catalog'
    }
    manifest.licenseMatrix.entries[0] = {
      ...manifest.licenseMatrix.entries[0],
      sourceId: 'reference_catalog',
      sourceUrl: 'https://omim.org/download/data.tsv',
      licenseUrl: 'https://omim.org/license'
    }

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('source is blocked for public snapshots')
    expect(result.errors.join('\n')).toContain('license matrix entry is blocked')
  })

  test('rejects blocklisted source URLs hidden in query parameters', () => {
    const manifest = validManifest()
    manifest.sources[0] = {
      ...manifest.sources[0],
      sourceId: 'reference_catalog',
      name: 'Reference catalog',
      license: {
        ...manifest.sources[0].license,
        url: 'https://example.org/license?source=https://omim.org/license'
      },
      provenanceUrl: 'https://example.org/source?download=https://omim.org/data.tsv'
    }
    manifest.fields[0] = {
      ...manifest.fields[0],
      sourceId: 'reference_catalog'
    }
    manifest.licenseMatrix.entries[0] = {
      ...manifest.licenseMatrix.entries[0],
      sourceId: 'reference_catalog',
      sourceUrl: 'https://example.org/data?source=https://omim.org/data.tsv',
      licenseUrl: 'https://example.org/license?source=https://omim.org/license'
    }

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('source is blocked for public snapshots')
    expect(result.errors.join('\n')).toContain('license matrix entry is blocked')
  })

  test('rejects local, non-https, and credential-bearing public URLs', () => {
    const fileManifest = validManifest()
    fileManifest.sources[0].provenanceUrl = 'file:///private/case.vcf'
    const fileResult = validatePublicAnnotationSnapshotManifest(fileManifest)
    expect(fileResult.ok).toBe(false)
    expect(fileResult.errors.join('\n')).toContain('sources.0.provenanceUrl')

    const ftpManifest = validManifest()
    ftpManifest.licenseMatrix.entries[0].sourceUrl = 'ftp://example.org/data.tsv'
    const ftpResult = validatePublicAnnotationSnapshotManifest(ftpManifest)
    expect(ftpResult.ok).toBe(false)
    expect(ftpResult.errors.join('\n')).toContain('licenseMatrix.entries.0.sourceUrl')

    const userInfoManifest = validManifest()
    userInfoManifest.sources[0].provenanceUrl = 'https://user:secret@example.org/source.json'
    const userInfoResult = validatePublicAnnotationSnapshotManifest(userInfoManifest)
    expect(userInfoResult.ok).toBe(false)
    expect(userInfoResult.errors.join('\n')).toContain('sources.0.provenanceUrl')

    const tokenManifest = validManifest()
    tokenManifest.sources[0].license.url = 'https://example.org/license?x_token=secret'
    tokenManifest.licenseMatrix.entries[0].licenseUrl = 'https://example.org/license?api_key=secret'
    const tokenResult = validatePublicAnnotationSnapshotManifest(tokenManifest)
    expect(tokenResult.ok).toBe(false)
    expect(tokenResult.errors.join('\n')).toContain('sources.0.license.url')
    expect(tokenResult.errors.join('\n')).toContain('licenseMatrix.entries.0.licenseUrl')
  })

  test('rejects blocklisted source license metadata and matrix attribution fields', () => {
    const sourceManifest = validManifest()
    sourceManifest.sources[0].license.name = 'OMIM commercial license'
    const sourceResult = validatePublicAnnotationSnapshotManifest(sourceManifest)
    expect(sourceResult.ok).toBe(false)
    expect(sourceResult.errors.join('\n')).toContain('source is blocked for public snapshots')

    const matrixManifest = validManifest()
    matrixManifest.licenseMatrix.entries[0].accession = 'OMIM:123456'
    matrixManifest.licenseMatrix.entries[0].attribution = 'OMIM'
    const matrixResult = validatePublicAnnotationSnapshotManifest(matrixManifest)
    expect(matrixResult.ok).toBe(false)
    expect(matrixResult.errors.join('\n')).toContain('license matrix entry is blocked')
  })

  test('rejects blocklisted source versions and review metadata', () => {
    const sourceManifest = validManifest()
    sourceManifest.sources[0].version = 'OMIM 2026 release'
    const sourceResult = validatePublicAnnotationSnapshotManifest(sourceManifest)
    expect(sourceResult.ok).toBe(false)
    expect(sourceResult.errors.join('\n')).toContain('source is blocked for public snapshots')

    const matrixManifest = validManifest()
    matrixManifest.licenseMatrix.entries[0].entryId = 'omim_policy'
    matrixManifest.licenseMatrix.entries[0].reviewer = 'OMIM reviewer'
    const matrixResult = validatePublicAnnotationSnapshotManifest(matrixManifest)
    expect(matrixResult.ok).toBe(false)
    expect(matrixResult.errors.join('\n')).toContain('license matrix entry is blocked')

    const releaseManifest = validManifest()
    releaseManifest.releaseReview.reviewer = 'OMIM reviewer'
    const releaseResult = validatePublicAnnotationSnapshotManifest(releaseManifest)
    expect(releaseResult.ok).toBe(false)
    expect(releaseResult.errors.join('\n')).toContain('release review is blocked')
  })

  test('requires matrix license evidence to match the source license record', () => {
    const manifest = validManifest()
    manifest.licenseMatrix.entries[0] = {
      ...manifest.licenseMatrix.entries[0],
      licenseId: 'other_public_license',
      licenseUrl: 'https://example.org/other-license',
      archivedTextChecksum: 'sha256:' + 'f'.repeat(64),
      attribution: 'Different attribution'
    }

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('license matrix entry must match source license evidence')
  })

  test('rejects private-looking license and review metadata across the manifest', () => {
    const sourceManifest = validManifest()
    sourceManifest.sources[0].license.licenseId = 'patient_license'
    sourceManifest.licenseMatrix.entries[0].licenseId = 'patient_license'
    const sourceResult = validatePublicAnnotationSnapshotManifest(sourceManifest)
    expect(sourceResult.ok).toBe(false)
    expect(sourceResult.errors.join('\n')).toContain('source metadata looks private')

    const matrixManifest = validManifest()
    matrixManifest.licenseMatrix.entries[0].entryId = 'patient_policy'
    matrixManifest.licenseMatrix.entries[0].reviewer = 'sample_case_review'
    const matrixResult = validatePublicAnnotationSnapshotManifest(matrixManifest)
    expect(matrixResult.ok).toBe(false)
    expect(matrixResult.errors.join('\n')).toContain('license matrix entry metadata looks private')

    const releaseManifest = validManifest()
    releaseManifest.releaseReview.reviewer = 'patient_case_review'
    const releaseResult = validatePublicAnnotationSnapshotManifest(releaseManifest)
    expect(releaseResult.ok).toBe(false)
    expect(releaseResult.errors.join('\n')).toContain('release review is blocked')
  })

  test('rejects blocklisted derived field names until field-level clearance exists', () => {
    const manifest = validManifest()
    manifest.fields[0] = {
      ...manifest.fields[0],
      name: 'caddphred'
    }
    manifest.licenseMatrix.entries[0].fieldName = 'caddphred'

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('field is blocked for public snapshots')
  })

  test('requires a public-eligible license matrix entry for each field', () => {
    const missingEntryManifest = validManifest()
    missingEntryManifest.licenseMatrix.entries = []
    expect(validatePublicAnnotationSnapshotManifest(missingEntryManifest).errors.join('\n')).toContain(
      'licenseMatrix.entries'
    )

    const unknownFieldManifest = validManifest()
    unknownFieldManifest.licenseMatrix.entries[0].fieldName = 'other_field'
    const unknownFieldResult = validatePublicAnnotationSnapshotManifest(unknownFieldManifest)
    expect(unknownFieldResult.ok).toBe(false)
    expect(unknownFieldResult.errors.join('\n')).toContain(
      'license matrix entry references unknown field'
    )
    expect(unknownFieldResult.errors.join('\n')).toContain('field is missing license matrix entry')
  })

  test('rejects non-public license matrix policy entries', () => {
    const manifest = validManifest()
    manifest.licenseMatrix.entries[0].redistributionClass = 'restricted'
    manifest.licenseMatrix.entries[0].shareAlike = true

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('license matrix entry is not public eligible')
  })

  test('rejects private-looking row count keys', () => {
    const manifest = validManifest()
    manifest.rowCounts = {
      patient_query_hits: 4
    }

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('rowCounts.<redacted>')
  })

  test('rejects unknown manifest, source, and field properties', () => {
    const manifest = validManifest() as PublicAnnotationSnapshotManifest & {
      caseData?: unknown
    }
    manifest.caseData = { sampleId: 'S1' }
    const sourceWithExtra = manifest.sources[0] as (typeof manifest.sources)[number] & {
      localPath?: string
    }
    sourceWithExtra.localPath = '/private/case.vcf'
    const fieldWithExtra = manifest.fields[0] as (typeof manifest.fields)[number] & {
      caseId?: string
    }
    fieldWithExtra.caseId = 'case-1'

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unrecognized_keys')
  })

  test('requires source and manifest checksums plus license/provenance/review evidence', () => {
    const manifest = validManifest() as Partial<PublicAnnotationSnapshotManifest>
    delete manifest.manifestChecksum
    delete manifest.contentHash
    delete manifest.releaseReview
    delete manifest.licenseMatrix
    delete manifest.sources?.[0].checksum
    delete manifest.sources?.[0].provenanceUrl
    delete manifest.sources?.[0].license.url
    delete manifest.sources?.[0].license.licenseId
    delete manifest.sources?.[0].license.archivedTextChecksum
    delete manifest.fields?.[0].promotionEligibility

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('manifestChecksum')
    expect(result.errors.join('\n')).toContain('sources.0.checksum')
    expect(result.errors.join('\n')).toContain('sources.0.provenanceUrl')
    expect(result.errors.join('\n')).toContain('sources.0.license.url')
    expect(result.errors.join('\n')).toContain('sources.0.license.licenseId')
    expect(result.errors.join('\n')).toContain('sources.0.license.archivedTextChecksum')
    expect(result.errors.join('\n')).toContain('fields.0.promotionEligibility')
    expect(result.errors.join('\n')).toContain('licenseMatrix')
    expect(result.errors.join('\n')).toContain('contentHash')
    expect(result.errors.join('\n')).toContain('releaseReview')
  })

  test('requires snapshot id to include content hash prefix', () => {
    const manifest = validManifest()
    manifest.snapshotId = 'clinvar-2026-06-22-bbbbbbbbbbbb'

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('content hash prefix')
  })

  test('redacts private unknown keys from schema errors', () => {
    const manifest = validManifest() as PublicAnnotationSnapshotManifest & {
      patient_jane_doe_mrn_123?: unknown
    }
    manifest.patient_jane_doe_mrn_123 = true

    const result = validatePublicAnnotationSnapshotManifest(manifest)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unrecognized_keys')
    expect(result.errors.join('\n')).not.toContain('patient_jane_doe_mrn_123')
  })

  test('assert helper throws concise fail-closed errors', () => {
    const manifest = validManifest()
    manifest.privacy.noPrivateData = false

    expect(() => assertPublicAnnotationSnapshotManifest(manifest)).toThrow(
      /Invalid public annotation snapshot manifest/
    )
  })
})
