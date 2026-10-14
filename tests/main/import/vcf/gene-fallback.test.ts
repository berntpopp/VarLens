// @vitest-environment node
/**
 * SV / CNV / STR rows without a CSQ/ANN gene get one from the bundled gene
 * reference at import, on the PostgreSQL row stream and the SQLite insert path.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import { createGeneFiller } from '../../../../src/main/import/vcf/gene-fallback'
import type { VcfMappedVariant } from '../../../../src/main/import/vcf/types'
import { prepareStatements, streamInsertVcf } from '../../../../src/main/workers/import-pipeline'
import { streamMappedVcfRows } from '../../../../src/main/workers/postgres-vcf-stream'

const GENE_REF = resolve(__dirname, '../../../../resources/gene_reference.db')
const VCF_DIR = resolve(__dirname, '../../../test-data/vcf')
const tmp = mkdtempSync(join(tmpdir(), 'varlens-gene-fallback-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

async function rows(file: string, build: string | null): Promise<VcfMappedVariant[]> {
  const fill = build === null ? undefined : createGeneFiller(GENE_REF, build)
  const out: VcfMappedVariant[] = []
  for await (const v of streamMappedVcfRows(
    file,
    'SAMPLE1',
    undefined,
    undefined,
    undefined,
    undefined,
    fill
  )) {
    out.push(v)
  }
  return out
}

const genes = (vs: VcfMappedVariant[]): Array<[string, number, string | null]> =>
  vs.map((v) => [v.variant_type, v.pos, v.gene_symbol])

describe('gene fallback at import', () => {
  it('Stranger STR rows carry no gene without the fallback', async () => {
    const vs = await rows(join(VCF_DIR, 'synthetic-str.vcf'), null)
    expect(vs.map((v) => v.gene_symbol)).toEqual([null, null, null, null])
  })

  it('names STR loci by REPID', async () => {
    const vs = await rows(join(VCF_DIR, 'synthetic-str.vcf'), 'GRCh38')
    expect(vs.map((v) => v.gene_symbol)).toEqual(['ATXN3', 'ATXN3', 'CSTB', 'NOTCH2NLC'])
  })

  it('falls back to HGNCId, then to the overlapped gene, for an unknown locus id', async () => {
    const text = readFileSync(join(VCF_DIR, 'synthetic-str.vcf'), 'utf-8')
      .replaceAll('REPID=CSTB;VARID=CSTB', 'REPID=LOCUS9;VARID=LOCUS9')
      .replaceAll('REPID=ATXN3;VARID=ATXN3;', 'REPID=LOCUS7;VARID=LOCUS7;')
      .replace('HGNCId=7106;', '')
    const file = join(tmp, 'unknown-locus.vcf')
    writeFileSync(file, text)
    const vs = await rows(file, 'GRCh38')
    // CSTB keeps HGNCId=2482; ATXN3 lost it and is found by coordinates.
    expect(vs.map((v) => v.gene_symbol)).toEqual(['ATXN3', 'ATXN3', 'CSTB', 'NOTCH2NLC'])
  })

  it('gives SV and CNV rows the overlapped gene and keeps annotated genes', async () => {
    expect(genes(await rows(join(VCF_DIR, 'synthetic-sv.vcf'), 'GRCh38'))).toEqual([
      ['sv', 1000000, 'GENE1'],
      ['sv', 2000000, 'CFAP74'],
      ['sv', 29000000, 'ZNRF3'],
      ['sv', 5000000, null],
      ['sv', 9000000, null]
    ])
    expect(genes(await rows(join(VCF_DIR, 'synthetic-cnv.vcf'), 'GRCh38'))).toEqual([
      ['cnv', 5000000, 'GENE_A'],
      ['cnv', 10000000, 'GENE_B'],
      ['cnv', 29500000, 'THOC5']
    ])
  })

  it('is a no-op without a gene reference', () => {
    const v = { variant_type: 'cnv', gene_symbol: null } as VcfMappedVariant
    createGeneFiller(join(tmp, 'missing.db'), 'GRCh38')(v)
    createGeneFiller(undefined, 'GRCh38')(v)
    expect(v.gene_symbol).toBeNull()
  })

  it('stores the gene on the SQLite import path, under the case build', async () => {
    const svc = new DatabaseService(':memory:')
    try {
      const file = join(VCF_DIR, 'synthetic-cnv.vcf')
      const caseId = svc.cases.createCase('cnv', file, 1)
      svc.database.prepare("UPDATE cases SET genome_build = 'GRCh38' WHERE id = ?").run(caseId)
      const stmts = prepareStatements(svc.database)
      // prettier-ignore
      await streamInsertVcf(file, { format: 'vcf', caseKey: '' }, caseId, 100, stmts, () => false, undefined, () => {}, undefined, undefined, undefined, undefined, GENE_REF)
      const stored = svc.database
        .prepare('SELECT gene_symbol FROM variants WHERE case_id = ? ORDER BY pos')
        .all(caseId)
      expect(stored).toEqual([
        { gene_symbol: 'GENE_A' },
        { gene_symbol: 'GENE_B' },
        { gene_symbol: 'THOC5' }
      ])
    } finally {
      svc.close()
    }
  })
})
