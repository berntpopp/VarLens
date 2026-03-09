import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import type { Variant } from '../../../src/main/database/types'
import type { TranscriptInsertRow } from '../../../src/shared/types/transcript'

type VariantInsert = Omit<Variant, 'id' | 'case_id'>

interface VariantWithTranscripts extends VariantInsert {
  _transcripts?: TranscriptInsertRow[]
}

describe('insertVariantsBatch with transcripts', () => {
  let db: DatabaseService
  let caseId: number

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = db.cases.createCase('test', '/test.json', 100)
  })

  afterEach(() => {
    db.close()
  })

  it('should insert transcript rows alongside variant', () => {
    const variants: VariantWithTranscripts[] = [
      {
        chr: '17',
        pos: 43094000,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'BRCA1',
        omim_mim_number: null,
        consequence: 'missense_variant',
        gnomad_af: 0.001,
        cadd: 28,
        clinvar: null,
        gt_num: '0/1',
        func: null,
        qual: 30,
        hpo_sim_score: null,
        transcript: 'NM_007294.4',
        cdna: 'c.123A>G',
        aa_change: 'p.His41Arg',
        moi: 'AD',
        _transcripts: [
          {
            transcript_id: 'NM_007294.4',
            gene_symbol: 'BRCA1',
            consequence: 'missense_variant',
            cdna: 'c.123A>G',
            aa_change: 'p.His41Arg',
            hpo_sim_score: null,
            moi: 'AD',
            is_selected: 1
          },
          {
            transcript_id: 'NM_007299.4',
            gene_symbol: 'BRCA1',
            consequence: 'synonymous_variant',
            cdna: 'c.456C>T',
            aa_change: null,
            hpo_sim_score: null,
            moi: 'AD',
            is_selected: 0
          }
        ]
      }
    ]

    db.variants.insertVariantsBatch(caseId, variants)

    const txRows = db.database.prepare('SELECT * FROM variant_transcripts').all() as Record<
      string,
      unknown
    >[]
    expect(txRows).toHaveLength(2)
    expect(txRows[0].transcript_id).toBe('NM_007294.4')
    expect(txRows[0].is_selected).toBe(1)
    expect(txRows[1].transcript_id).toBe('NM_007299.4')
    expect(txRows[1].is_selected).toBe(0)
  })

  it('should work without _transcripts (backwards compatible)', () => {
    const variants: VariantInsert[] = [
      {
        chr: '1',
        pos: 100,
        ref: 'C',
        alt: 'T',
        gene_symbol: null,
        omim_mim_number: null,
        consequence: null,
        gnomad_af: null,
        cadd: null,
        clinvar: null,
        gt_num: null,
        func: null,
        qual: null,
        hpo_sim_score: null,
        transcript: null,
        cdna: null,
        aa_change: null,
        moi: null
      }
    ]

    db.variants.insertVariantsBatch(caseId, variants)

    const txRows = db.database.prepare('SELECT * FROM variant_transcripts').all()
    expect(txRows).toHaveLength(0)
  })
})
