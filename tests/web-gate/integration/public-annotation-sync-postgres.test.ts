import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { PostgresPublicAnnotationRepository } from '../../../src/main/storage/postgres/PostgresPublicAnnotationRepository'
import {
  syncPublicAnnotationPayload,
  type PublicAnnotationSyncPayload
} from '../../../src/web/sync-public-annotations'

const RUN_POSTGRES = Boolean(process.env.VARLENS_PG_URL)

const checksum = (char: string): string => `sha256:${char.repeat(64)}`

describe.skipIf(!RUN_POSTGRES)('public annotation sync - PostgreSQL integration', () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const snapshotId = `clinvar-2026-06-22-${suffix}`

  let pool: Pool | undefined
  let root: string | undefined

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.VARLENS_PG_URL, max: 1 })
    root = await mkdtemp(join(tmpdir(), 'varlens-public-annotation-sync-'))
    await mkdir(join(root, 'vcf'), { recursive: true })
  })

  afterEach(async () => {
    if (pool !== undefined) {
      await pool
        .query('DELETE FROM public_annotation_snapshots WHERE snapshot_id = $1', [snapshotId])
        .catch(() => {})
      await pool.end()
      pool = undefined
    }
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true })
      root = undefined
    }
  })

  test('syncs a public-safe bundle into Postgres and reads it back through the repository', async () => {
    const vcfPath = join(root!, 'vcf/snv.vcf.gz')
    await writeFile(
      vcfPath,
      gzipSync(
        [
          '##fileformat=VCFv4.3',
          '##INFO=<ID=CSQ,Number=.,Type=String,Description="Consequence annotations from Ensembl VEP. Format: Allele|Consequence|IMPACT|SYMBOL|Gene|Feature|HGVSc|HGVSp|ClinVarCurrent_CLNSIG|ClinVarCurrent_CLNREVSTAT|ClinVarCurrent_CLNDN|ClinVarCurrent_ALLELEID|Sample_ID">',
          '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
          '1\t12345\t.\tA\tG\t.\tPASS\tCSQ=G|missense_variant|MODERATE|GENE1|ENSG0001|ENST0001|c.1A>G|p.Lys1Arg|Pathogenic|reviewed_by_expert_panel|Disease one|123|sample-001',
          ''
        ].join('\n')
      )
    )
    const payload: PublicAnnotationSyncPayload = {
      schemaVersion: 'varlens.annotation-bundle.v1',
      sourceManifestPath: join(root!, 'varlens_annotation_bundle_manifest.json'),
      sourceManifestChecksum: checksum('9'),
      privateCaseData: false,
      sourcePrivateCaseDataRedacted: true,
      snapshot: {
        snapshotId,
        bundleId: `bundle-2026-06-22-${suffix}`,
        genomeBuild: 'GRCh38',
        mappingVersion: 'public-snapshot-map-v1',
        contentHash: checksum('a'),
        manifestChecksum: checksum('b'),
        licenseMatrixChecksum: checksum('c')
      },
      files: [],
      variantRecordSources: [{ role: 'snv_vcf', absolutePath: vcfPath }],
      storedManifest: {
        schemaVersion: 'varlens.annotation-bundle.v1',
        files: { redacted: true, count: 3 }
      }
    }

    await expect(syncPublicAnnotationPayload(pool!, payload)).resolves.toStrictEqual({
      variantRecordCount: 11
    })

    const snapshotRows = await pool!.query(
      `
        SELECT private_case_data, stored_manifest_json
        FROM public_annotation_snapshots
        WHERE snapshot_id = $1
      `,
      [snapshotId]
    )
    expect(snapshotRows.rows).toHaveLength(1)
    expect(snapshotRows.rows[0].private_case_data).toBe(false)
    expect(JSON.stringify(snapshotRows.rows[0].stored_manifest_json)).not.toContain(
      'vcf/snv.vcf.gz'
    )

    const repository = new PostgresPublicAnnotationRepository(pool!)
    const references = await repository.getReferencesForVariant({
      chr: '1',
      pos: 12345,
      ref: 'A',
      alt: 'G'
    })

    expect(references.snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshotId,
          privateCaseData: false,
          publicFileCount: 0
        })
      ])
    )
    expect(references.variantRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshotId,
          sourceId: 'clinvar_current',
          fieldName: 'clinical_significance',
          fieldValue: 'Pathogenic'
        }),
        expect.objectContaining({
          snapshotId,
          sourceId: 'vep',
          fieldName: 'gene_symbol',
          fieldValue: 'GENE1'
        })
      ])
    )
    expect(JSON.stringify(references.variantRecords)).not.toContain('sample-001')
  })
})
