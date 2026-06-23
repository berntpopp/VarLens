import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { afterEach, describe, expect, test } from 'vitest'

import {
  buildPublicAnnotationSyncPayload,
  syncPublicAnnotationPayload,
  type PublicAnnotationSyncPayload
} from '../../../src/web/sync-public-annotations'

const checksum = (char: string): string => `sha256:${char.repeat(64)}`
const zeroChecksum = checksum('0')

async function writeFixture(
  path: string,
  content: string
): Promise<{ checksum: string; sizeBytes: number }> {
  await writeFile(path, content)
  const { createHash } = await import('node:crypto')
  const digest = createHash('sha256').update(content).digest('hex')
  return { checksum: `sha256:${digest}`, sizeBytes: Buffer.byteLength(content) }
}

function validPublicSnapshotManifest(): Record<string, unknown> {
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
      matrixChecksum: checksum('e'),
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
          archivedTextChecksum: checksum('c'),
          redistributionClass: 'public_redistributable',
          clinicalUse: 'allowed',
          attribution: 'ClinVar, NCBI',
          derivativeInheritance: 'none',
          shareAlike: false,
          promotionEligibility: 'public_snapshot',
          reviewer: 'license_review',
          reviewedAt: '2026-06-22T09:30:00.000Z',
          evidenceChecksum: checksum('d')
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
          archivedTextChecksum: checksum('c'),
          attribution: 'ClinVar, NCBI'
        },
        provenanceUrl: 'https://example.org/clinvar-provenance.json',
        checksum: checksum('a')
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
    manifestChecksum: checksum('b'),
    contentHash: checksum('a'),
    releaseReview: {
      reviewer: 'license_review',
      reviewedAt: '2026-06-22T10:30:00.000Z',
      evidenceChecksum: checksum('d')
    }
  }
}

function basePayload(): PublicAnnotationSyncPayload {
  return {
    schemaVersion: 'varlens.public-annotation-snapshot.v1',
    sourceManifestPath: '/tmp/public-snapshot.json',
    sourceManifestChecksum: checksum('9'),
    privateCaseData: false,
    sourcePrivateCaseDataRedacted: false,
    snapshot: {
      snapshotId: 'clinvar-2026-06-22-aaaaaaaaaaaa',
      bundleId: null,
      genomeBuild: 'GRCh38',
      mappingVersion: 'public-snapshot-map-v1',
      contentHash: checksum('a'),
      manifestChecksum: checksum('b'),
      licenseMatrixChecksum: checksum('e')
    },
    files: [],
    variantRecordSources: [],
    storedManifest: validPublicSnapshotManifest()
  }
}

class FakeClient {
  readonly queries: Array<{ text: string; values?: unknown[] }> = []
  released = false

  constructor(private readonly existingRows: unknown[] = []) {}

  async query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
    this.queries.push({ text, values })
    if (text.includes('FROM public_annotation_snapshots') && text.includes('WHERE snapshot_id')) {
      return { rows: this.existingRows }
    }
    return { rows: [] }
  }

  release(): void {
    this.released = true
  }
}

describe('sync-public-annotations command helpers', () => {
  afterEach(() => {
    delete process.env.VARLENS_PUBLIC_ANNOTATION_WRITE_PG_URL
    delete process.env.VARLENS_PG_URL
  })

  test('accepts a private annotation bundle but redacts private file inventory for the public DB', async () => {
    const root = await mkdtemp(join(tmpdir(), 'varlens-sync-public-annotations-'))
    await mkdir(root, { recursive: true })
    await mkdir(join(root, 'reports'), { recursive: true })
    await mkdir(join(root, 'vcf'), { recursive: true })

    const report = await writeFixture(join(root, 'reports/report.json'), '{"ok":true}\n')
    const vcf = await writeFixture(
      join(root, 'vcf/snv.vcf.gz'),
      [
        '##fileformat=VCFv4.3',
        '##INFO=<ID=CSQ,Number=.,Type=String,Description="Consequence annotations from Ensembl VEP. Format: Allele|Consequence|IMPACT|SYMBOL|Gene|Feature|HGVSc|HGVSp|ClinVarCurrent_CLNSIG|ClinVarCurrent_CLNREVSTAT|ClinVarCurrent_CLNDN|ClinVarCurrent_ALLELEID|CADD_phred">',
        '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
        '1\t12345\t.\tA\tG\t.\tPASS\tCSQ=G|missense_variant|MODERATE|GENE1|ENSG0001|ENST0001|c.1A>G|p.Lys1Arg|Pathogenic|reviewed_by_expert_panel|Disease one|123|30.1',
        ''
      ].join('\n')
    )
    const tbi = await writeFixture(join(root, 'vcf/snv.vcf.gz.tbi'), 'index\n')
    const manifestPath = join(root, 'annotation-bundle.json')
    const manifest = {
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
          path: 'annotation-bundle.json',
          checksum: zeroChecksum,
          sizeBytes: 0,
          required: true
        },
        {
          role: 'report',
          path: 'reports/report.json',
          checksum: report.checksum,
          sizeBytes: report.sizeBytes,
          required: true
        },
        {
          role: 'snv_vcf',
          path: 'vcf/snv.vcf.gz',
          checksum: vcf.checksum,
          sizeBytes: vcf.sizeBytes,
          required: true,
          indexPath: 'vcf/snv.vcf.gz.tbi',
          indexChecksum: tbi.checksum,
          indexSizeBytes: tbi.sizeBytes,
          formatVersion: 'VCFv4.3'
        }
      ],
      tools: [],
      importOrder: ['manifest', 'snv_vcf', 'report'],
      privacy: {
        privateCaseData: true,
        publicSnapshotReferenceOnly: true
      },
      checksums: {
        manifest: checksum('8'),
        inventory: checksum('9')
      }
    }
    await writeFile(manifestPath, JSON.stringify(manifest))

    const payload = await buildPublicAnnotationSyncPayload(manifestPath)

    expect(payload.privateCaseData).toBe(false)
    expect(payload.sourcePrivateCaseDataRedacted).toBe(true)
    expect(payload.files).toEqual([])
    expect(payload.variantRecordSources).toHaveLength(1)
    expect(payload.snapshot.snapshotId).toBe('clinvar-2026-06-22-aaaaaaaaaaaa')
    expect(payload.storedManifest).toMatchObject({
      files: {
        redacted: true,
        count: 3
      }
    })
    expect(JSON.stringify(payload.storedManifest)).not.toContain('vcf/snv.vcf.gz')
  })

  test('accepts a license-cleared public snapshot manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'varlens-sync-public-snapshot-'))
    const manifestPath = join(root, 'public-snapshot.json')
    await writeFile(manifestPath, JSON.stringify(validPublicSnapshotManifest()))

    const payload = await buildPublicAnnotationSyncPayload(manifestPath)

    expect(payload.privateCaseData).toBe(false)
    expect(payload.sourcePrivateCaseDataRedacted).toBe(false)
    expect(payload.schemaVersion).toBe('varlens.public-annotation-snapshot.v1')
    expect(payload.snapshot.licenseMatrixChecksum).toBe(checksum('e'))
    expect(payload.storedManifest).toMatchObject({ privacy: { noPrivateData: true } })
  })

  test('creates and writes the public annotation registry in one transaction', async () => {
    const client = new FakeClient()
    const pool = { connect: async () => client }

    await expect(syncPublicAnnotationPayload(pool, basePayload())).resolves.toStrictEqual({
      variantRecordCount: 0
    })

    const sql = client.queries.map((query) => query.text).join('\n')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public_annotation_snapshots')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public_annotation_variant_records')
    expect(sql).toContain('INSERT INTO public_annotation_snapshots')
    expect(sql).toContain('INSERT INTO public_annotation_sync_events')
    expect(client.queries.at(-1)?.text).toBe('COMMIT')
    expect(client.released).toBe(true)
  })

  test('imports public-safe variant records from the annotation bundle SNV VCF', async () => {
    const root = await mkdtemp(join(tmpdir(), 'varlens-sync-public-records-'))
    await mkdir(join(root, 'vcf'), { recursive: true })
    const vcfPath = join(root, 'vcf/snv.vcf.gz')
    await writeFile(
      vcfPath,
      gzipSync(
        [
          '##fileformat=VCFv4.3',
          '##INFO=<ID=CSQ,Number=.,Type=String,Description="Consequence annotations from Ensembl VEP. Format: Allele|Consequence|IMPACT|SYMBOL|Gene|Feature|HGVSc|HGVSp|ClinVarCurrent_CLNSIG|ClinVarCurrent_CLNREVSTAT|ClinVarCurrent_CLNDN|ClinVarCurrent_ALLELEID|CADD_phred|SpliceAI_pred_DS_AG">',
          '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
          '1\t12345\t.\tA\tG\t.\tPASS\tCSQ=G|missense_variant|MODERATE|GENE1|ENSG0001|ENST0001|c.1A>G|p.Lys1Arg|Pathogenic|reviewed_by_expert_panel|Disease one|123|30.1|0.8',
          ''
        ].join('\n')
      )
    )
    const payload: PublicAnnotationSyncPayload = {
      ...basePayload(),
      schemaVersion: 'varlens.annotation-bundle.v1',
      privateCaseData: false,
      sourcePrivateCaseDataRedacted: true,
      snapshot: {
        ...basePayload().snapshot,
        bundleId: 'bundle-2026-06-22-aaaaaaaaaaaa',
        mappingVersion: 'annotation-bundle-map-v1'
      },
      variantRecordSources: [{ role: 'snv_vcf', absolutePath: vcfPath }]
    }
    const client = new FakeClient()
    const pool = { connect: async () => client }

    await expect(syncPublicAnnotationPayload(pool, payload)).resolves.toStrictEqual({
      variantRecordCount: 11
    })

    const variantInsert = client.queries.find((query) =>
      query.text.includes('INSERT INTO public_annotation_variant_records')
    )
    expect(variantInsert?.values).toContain('clinical_significance')
    expect(variantInsert?.values).toContain('"Pathogenic"')
    expect(variantInsert?.values).toContain('gene_symbol')
    expect(variantInsert?.values).not.toContain('CADD_phred')
    expect(variantInsert?.values).not.toContain('SpliceAI_pred_DS_AG')
  })

  test('rejects snapshot ID reuse with changed immutable checksums', async () => {
    const client = new FakeClient([
      {
        content_hash: checksum('f'),
        manifest_checksum: checksum('b'),
        license_matrix_checksum: checksum('e')
      }
    ])
    const pool = { connect: async () => client }

    await expect(syncPublicAnnotationPayload(pool, basePayload())).rejects.toThrow(
      'already exists with different immutable checksums'
    )

    expect(client.queries.at(-1)?.text).toBe('ROLLBACK')
    expect(client.released).toBe(true)
  })
})
