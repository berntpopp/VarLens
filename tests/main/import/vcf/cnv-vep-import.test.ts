// @vitest-environment node
/**
 * VEP-annotated Spectre CNVs (the annotation workflow's `*.cnv.vep.vcf.gz`
 * shape: symbolic `<DEL>`/`<DUP>`, one CSQ entry per overlapped transcript or
 * regulatory feature, OverlapBP/OverlapPC) through the real SQLite import.
 */
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import type { VcfHeader } from '../../../../src/main/import/vcf/types'
import { parseAnnotation } from '../../../../src/main/import/vcf/vcf-annotation-parser'
import { prepareStatements, streamInsertVcf } from '../../../../src/main/workers/import-pipeline'

const GENE_REF = resolve(__dirname, '../../../../resources/gene_reference.db')
const FIXTURE = resolve(__dirname, '../../../test-data/vcf/synthetic-cnv-vep.vcf')

describe('VEP-annotated CNV import', () => {
  let svc: DatabaseService
  let caseId: number

  beforeAll(async () => {
    svc = new DatabaseService(':memory:')
    caseId = svc.cases.createCase('cnv-vep', FIXTURE, 1)
    svc.database.prepare("UPDATE cases SET genome_build = 'GRCh38' WHERE id = ?").run(caseId)
    // prettier-ignore
    await streamInsertVcf(FIXTURE, { format: 'vcf', caseKey: '' }, caseId, 100, prepareStatements(svc.database), () => false, undefined, () => {}, undefined, undefined, undefined, undefined, GENE_REF)
  })
  afterAll(() => svc.close())

  it('stores gene, IMPACT as consequence, SO term as func, and the CNV fields', () => {
    const rows = svc.database
      .prepare(
        `SELECT v.pos, v.variant_type, v.sv_type, v.end_pos, v.sv_length, v.gene_symbol,
                v.consequence, v.func, c.copy_number
         FROM variants v JOIN variant_cnv c ON c.variant_id = v.id
         WHERE v.case_id = ? ORDER BY v.id`
      )
      .all(caseId)
    expect(rows).toEqual([
      // DUP over one gene: the MANE transcript, not the regulatory feature listed first.
      {
        pos: 15200000,
        variant_type: 'cnv',
        sv_type: 'DUP',
        end_pos: 15300000,
        sv_length: 100000,
        gene_symbol: 'PMP22',
        consequence: 'HIGH',
        func: 'transcript_amplification',
        copy_number: 3
      },
      // Pseudogene listed first and HIGH, but the MANE protein-coding gene wins.
      {
        pos: 22700000,
        variant_type: 'cnv',
        sv_type: 'DEL',
        end_pos: 22850000,
        sv_length: 150000,
        gene_symbol: 'NIPA1',
        consequence: 'HIGH',
        func: 'transcript_ablation',
        copy_number: 1
      },
      // CSQ names NIPA2 (most severe); the fallback would have named NIPA1.
      {
        pos: 22800000,
        variant_type: 'cnv',
        sv_type: 'DEL',
        end_pos: 22870000,
        sv_length: 70000,
        gene_symbol: 'NIPA2',
        consequence: 'HIGH',
        func: 'transcript_ablation',
        copy_number: 0
      },
      // MANE transcript is only upstream (MODIFIER): the HIGH gene wins for a CNV.
      {
        pos: 15400000,
        variant_type: 'cnv',
        sv_type: 'DUP',
        end_pos: 15450000,
        sv_length: 50000,
        gene_symbol: 'CDRT4',
        consequence: 'HIGH',
        func: 'transcript_amplification',
        copy_number: 3
      },
      // No CSQ: the gene-reference overlap fallback names it.
      {
        pos: 22990000,
        variant_type: 'cnv',
        sv_type: 'DEL',
        end_pos: 23030000,
        sv_length: 40000,
        gene_symbol: 'TUBGCP5',
        consequence: null,
        func: null,
        copy_number: 1
      }
    ])
  })

  it('keeps every overlapped gene of a multi-gene CNV in variant_transcripts', () => {
    const genes = svc.database
      .prepare(
        `SELECT v.pos, group_concat(DISTINCT t.gene_symbol) AS genes
         FROM variants v JOIN variant_transcripts t ON t.variant_id = v.id
         WHERE v.case_id = ? AND t.gene_symbol <> '' GROUP BY v.id ORDER BY v.id`
      )
      .all(caseId) as Array<{ pos: number; genes: string }>
    expect(genes.map((g) => [g.pos, g.genes.split(',').sort()])).toEqual([
      [15200000, ['PMP22']],
      [22700000, ['NIPA1', 'NIPA2', 'PDCD6IPP1']],
      [22800000, ['CYFIP1', 'NIPA1', 'NIPA2']],
      [15400000, ['CDRT4', 'TEKT3']]
    ])
  })
})

describe('CSQ transcript pick: SNV vs structural', () => {
  const header = {
    annotationType: 'csq',
    csqFields: ['Allele', 'Consequence', 'IMPACT', 'SYMBOL', 'Feature', 'MANE_SELECT'],
    rawHeaderLines: []
  } as unknown as VcfHeader
  const csq = (allele: string): string =>
    `${allele}|intron_variant|MODIFIER|GENE1|T1|NM_1.1,${allele}|stop_gained|HIGH|GENE2|T2|`

  it('keeps MANE first for an SNV', () => {
    const info = new Map([['CSQ', csq('T')]])
    expect(parseAnnotation(info, header, 'T', 'C').geneSymbol).toBe('GENE1')
  })

  it('ranks IMPACT above MANE for a symbolic SV/CNV', () => {
    const info = new Map([
      ['SVTYPE', 'DEL'],
      ['CSQ', csq('deletion')]
    ])
    expect(parseAnnotation(info, header, '<DEL>', 'N').geneSymbol).toBe('GENE2')
  })

  it('prefers a named gene among equally severe SV/CNV transcripts', () => {
    const info = new Map([
      ['SVTYPE', 'DEL'],
      ['CSQ', 'deletion|transcript_ablation|HIGH||T0|,deletion|transcript_ablation|HIGH|GENE3|T3|']
    ])
    expect(parseAnnotation(info, header, '<DEL>', 'N').geneSymbol).toBe('GENE3')
  })
})
