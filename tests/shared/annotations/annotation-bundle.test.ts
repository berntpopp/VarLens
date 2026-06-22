import { describe, expect, test } from 'vitest'

import {
  assertAnnotationBundleManifest,
  validateAnnotationBundleManifest,
  type AnnotationBundleManifest
} from '../../../src/shared/annotations/annotation-bundle'

const checksum = (char: string): string => `sha256:${char.repeat(64)}`

function validBundle(): AnnotationBundleManifest {
  return {
    schemaVersion: 'varlens.annotation-bundle.v1',
    bundleId: 'bundle-2026-06-22-aaaaaaaaaaaa',
    createdAt: '2026-06-22T10:00:00.000Z',
    genomeBuild: 'GRCh38',
    mappingVersion: 'annotation-bundle-map-v1',
    publicSnapshot: {
      snapshotId: 'clinvar-2026-06-22-aaaaaaaaaaaa',
      contentHash: checksum('a'),
      mappingVersion: 'public-snapshot-map-v1',
      manifestChecksum: checksum('b'),
      licenseMatrixChecksum: checksum('e')
    },
    files: [
      {
        role: 'manifest',
        path: 'manifest/annotation-bundle.json',
        checksum: checksum('1'),
        sizeBytes: 2048,
        required: true
      },
      {
        role: 'report',
        path: 'reports/annotation-report.json',
        checksum: checksum('2'),
        sizeBytes: 4096,
        required: true
      },
      {
        role: 'snv_vcf',
        path: 'vcf/snv.vcf.gz',
        checksum: checksum('3'),
        sizeBytes: 100000,
        required: true,
        indexPath: 'vcf/snv.vcf.gz.tbi',
        indexChecksum: checksum('c'),
        indexSizeBytes: 1000,
        formatVersion: 'VCFv4.3'
      },
      {
        role: 'sv_vcf',
        path: 'vcf/sv.vcf.gz',
        checksum: checksum('4'),
        sizeBytes: 50000,
        required: false,
        indexPath: 'vcf/sv.vcf.gz.tbi',
        indexChecksum: checksum('d'),
        indexSizeBytes: 1000,
        formatVersion: 'VCFv4.3'
      },
      {
        role: 'cnv_vcf',
        path: 'vcf/cnv.vcf.gz',
        checksum: checksum('a'),
        sizeBytes: 30000,
        required: false,
        indexPath: 'vcf/cnv.vcf.gz.tbi',
        indexChecksum: checksum('e'),
        indexSizeBytes: 1000,
        formatVersion: 'VCFv4.3'
      },
      {
        role: 'str_vcf',
        path: 'vcf/str.vcf.gz',
        checksum: checksum('b'),
        sizeBytes: 20000,
        required: false,
        indexPath: 'vcf/str.vcf.gz.tbi',
        indexChecksum: checksum('f'),
        indexSizeBytes: 1000,
        formatVersion: 'VCFv4.3'
      },
      {
        role: 'annotsv_tsv',
        path: 'sidecars/annotsv.tsv',
        checksum: checksum('5'),
        sizeBytes: 75000,
        required: false
      },
      {
        role: 'straglr_tsv',
        path: 'sidecars/straglr.tsv',
        checksum: checksum('6'),
        sizeBytes: 25000,
        required: false
      }
    ],
    tools: [
      {
        name: 'varlens-annotation-workflows',
        version: '2026.06.22',
        commandLineChecksum: checksum('7')
      }
    ],
    importOrder: [
      'manifest',
      'snv_vcf',
      'sv_vcf',
      'cnv_vcf',
      'str_vcf',
      'annotsv_tsv',
      'straglr_tsv',
      'report'
    ],
    privacy: {
      privateCaseData: true,
      publicSnapshotReferenceOnly: true
    },
    checksums: {
      manifest: checksum('8'),
      inventory: checksum('9')
    }
  }
}

describe('annotation bundle manifest contract', () => {
  test('accepts a versioned bundle and builds a deterministic import plan', () => {
    const result = validateAnnotationBundleManifest(validBundle())

    expect(result).toMatchObject({ ok: true, errors: [] })
    expect(result.importPlan?.bundleId).toBe('bundle-2026-06-22-aaaaaaaaaaaa')
    expect(result.importPlan?.variantFiles.map((file) => file.role)).toEqual([
      'snv_vcf',
      'sv_vcf',
      'cnv_vcf',
      'str_vcf'
    ])
    expect(result.importPlan?.sidecarFiles.map((file) => file.role)).toEqual([
      'annotsv_tsv',
      'straglr_tsv'
    ])
    expect(result.importPlan?.orderedFiles.map((file) => file.role)).toEqual([
      'manifest',
      'snv_vcf',
      'sv_vcf',
      'cnv_vcf',
      'str_vcf',
      'annotsv_tsv',
      'straglr_tsv',
      'report'
    ])
  })

  test('rejects mutable bundle and public snapshot identifiers', () => {
    const bundle = validBundle()
    bundle.bundleId = 'bundle-latest'
    bundle.publicSnapshot.snapshotId = 'clinvar-current'

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('bundleId')
    expect(result.errors.join('\n')).toContain('publicSnapshot.snapshotId')
  })

  test('rejects incomplete or mismatched public snapshot references', () => {
    const missingManifestChecksum = validBundle() as AnnotationBundleManifest & {
      publicSnapshot: Partial<AnnotationBundleManifest['publicSnapshot']>
    }
    delete missingManifestChecksum.publicSnapshot.manifestChecksum
    const missingResult = validateAnnotationBundleManifest(missingManifestChecksum)
    expect(missingResult.ok).toBe(false)
    expect(missingResult.errors.join('\n')).toContain('publicSnapshot.manifestChecksum')

    const mismatch = validBundle()
    mismatch.publicSnapshot.contentHash = checksum('c')
    const mismatchResult = validateAnnotationBundleManifest(mismatch)
    expect(mismatchResult.ok).toBe(false)
    expect(mismatchResult.errors.join('\n')).toContain('publicSnapshot.snapshotId')
  })

  test('rejects unsafe bundle file paths before import planning', () => {
    const bundle = validBundle()
    bundle.files[0].path = '../private/case.vcf'
    bundle.files[2].indexPath = '/tmp/snv.vcf.gz.tbi'

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('files.0.path')
    expect(result.errors.join('\n')).toContain('files.2.indexPath')
  })

  test('requires manifest, report, and at least one variant VCF', () => {
    const bundle = validBundle()
    bundle.files = bundle.files.filter(
      (file) => file.role !== 'manifest' && file.role !== 'report' && !file.role.endsWith('_vcf')
    )

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('bundle must include its source manifest file')
    expect(result.errors.join('\n')).toContain('bundle must include a report file')
    expect(result.errors.join('\n')).toContain('bundle must include at least one variant VCF')
  })

  test.each(['snv_vcf', 'sv_vcf', 'cnv_vcf', 'str_vcf'] as const)(
    'requires %s indexes',
    (role) => {
      const bundle = validBundle()
      const file = bundle.files.find((candidate) => candidate.role === role)
      expect(file).toBeDefined()
      if (file !== undefined) {
        delete file.indexPath
      }

      const result = validateAnnotationBundleManifest(bundle)

      expect(result.ok).toBe(false)
      expect(result.errors.join('\n')).toContain(`${role} requires an indexPath`)
    }
  )

  test('requires checksum and size metadata for index files', () => {
    const bundle = validBundle()
    const snvFile = bundle.files.find((file) => file.role === 'snv_vcf')
    expect(snvFile).toBeDefined()
    if (snvFile !== undefined) {
      delete snvFile.indexChecksum
      delete snvFile.indexSizeBytes
    }

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('snv_vcf indexPath requires an indexChecksum')
    expect(result.errors.join('\n')).toContain('snv_vcf indexPath requires indexSizeBytes')
  })

  test('rejects index integrity metadata without an index path', () => {
    const bundle = validBundle()
    const sidecarFile = bundle.files.find((file) => file.role === 'annotsv_tsv')
    expect(sidecarFile).toBeDefined()
    if (sidecarFile !== undefined) {
      sidecarFile.indexChecksum = checksum('0')
      sidecarFile.indexSizeBytes = 10
    }

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('annotsv_tsv index integrity fields require an indexPath')
  })

  test('rejects import-order roles that are not present in the inventory', () => {
    const bundle = validBundle()
    bundle.importOrder = ['manifest', 'cnv_vcf', 'report']
    bundle.files = bundle.files.filter((file) => file.role !== 'cnv_vcf')

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('importOrder references missing role cnv_vcf')
  })

  test('allows AnnotSV and Straglr sidecars to be absent when not required by the bundle', () => {
    const bundle = validBundle()
    bundle.files = bundle.files.filter(
      (file) => file.role !== 'annotsv_tsv' && file.role !== 'straglr_tsv'
    )
    bundle.importOrder = bundle.importOrder.filter(
      (role) => role !== 'annotsv_tsv' && role !== 'straglr_tsv'
    )

    const result = validateAnnotationBundleManifest(bundle)

    expect(result).toMatchObject({ ok: true, errors: [] })
    expect(result.importPlan?.sidecarFiles).toEqual([])
  })

  test('requires report and manifest inventory entries to be marked required', () => {
    const bundle = validBundle()
    const manifestFile = bundle.files.find((file) => file.role === 'manifest')
    const reportFile = bundle.files.find((file) => file.role === 'report')
    expect(manifestFile).toBeDefined()
    expect(reportFile).toBeDefined()
    if (manifestFile !== undefined) manifestFile.required = false
    if (reportFile !== undefined) reportFile.required = false

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('manifest must have at least one required file')
    expect(result.errors.join('\n')).toContain('report must have at least one required file')
  })

  test('rejects disabled privacy boundary literals', () => {
    const bundle = validBundle()
    bundle.privacy.privateCaseData = false

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('privacy.privateCaseData')
  })

  test('rejects malformed file and inventory checksums', () => {
    const bundle = validBundle()
    bundle.files[0].checksum = 'md5:bad'
    bundle.checksums.inventory = 'sha256:not-hex'

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('files.0.checksum')
    expect(result.errors.join('\n')).toContain('checksums.inventory')
  })

  test('rejects unknown manifest and file properties', () => {
    const bundle = validBundle() as AnnotationBundleManifest & { workspaceId?: string }
    bundle.workspaceId = 'private-workspace'
    const fileWithExtra = bundle.files[0] as (typeof bundle.files)[number] & {
      localPath?: string
    }
    fileWithExtra.localPath = '/tmp/private.vcf'

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unrecognized_keys')
  })

  test('rejects duplicate paths and optional-only required families', () => {
    const bundle = validBundle()
    bundle.files[1].path = bundle.files[0].path
    bundle.files[2].required = false

    const result = validateAnnotationBundleManifest(bundle)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('bundle file path is duplicated')
    expect(result.errors.join('\n')).toContain('bundle must include at least one required variant VCF')
  })

  test('assert helper throws concise fail-closed errors', () => {
    const bundle = validBundle()
    bundle.privacy.publicSnapshotReferenceOnly = false

    expect(() => assertAnnotationBundleManifest(bundle)).toThrow(
      /Invalid annotation bundle manifest/
    )
  })
})
