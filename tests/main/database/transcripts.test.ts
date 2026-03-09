import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import type { Variant } from '../../../src/main/database/types'

type VariantInsert = Omit<Variant, 'id' | 'case_id'>

function makeVariant(overrides: Partial<VariantInsert> = {}): VariantInsert {
  return {
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
    ...overrides
  }
}

describe('DatabaseService transcript methods', () => {
  let db: DatabaseService
  let caseId: number
  let variantId: number

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = db.cases.createCase('test', '/test.json', 100)
    db.variants.insertVariantsBatch(caseId, [makeVariant()])

    // Get the variant ID
    const variants = db.variants.getVariants({ case_id: caseId }, 10)
    variantId = variants.data[0].id

    // Insert multiple transcript rows for testing
    const insertTx = db.database.prepare(`
      INSERT INTO variant_transcripts (variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi, is_selected)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insertTx.run(
      variantId,
      'NM_007294.4',
      'BRCA1',
      'missense_variant',
      'c.123A>G',
      'p.His41Arg',
      null,
      'AD',
      1
    )
    insertTx.run(
      variantId,
      'NM_007299.4',
      'BRCA1',
      'synonymous_variant',
      'c.456C>T',
      null,
      null,
      'AD',
      0
    )
    insertTx.run(
      variantId,
      'NR_027676.2',
      'BRCA1',
      'non_coding_transcript_variant',
      null,
      null,
      null,
      null,
      0
    )
  })

  afterEach(() => {
    db.close()
  })

  describe('getVariantTranscripts', () => {
    it('should return all transcripts for a variant', () => {
      const transcripts = db.transcripts.getVariantTranscripts(variantId)
      expect(transcripts).toHaveLength(3)
    })

    it('should return selected transcript first', () => {
      const transcripts = db.transcripts.getVariantTranscripts(variantId)
      expect(transcripts[0].transcript_id).toBe('NM_007294.4')
      expect(transcripts[0].is_selected).toBe(true)
    })

    it('should return empty array for variant with no transcripts', () => {
      db.variants.insertVariantsBatch(caseId, [
        makeVariant({ transcript: null, chr: '2', pos: 999 })
      ])
      const variants = db.variants.getVariants({ case_id: caseId }, 10)
      const otherVariant = variants.data.find((v) => v.chr === '2')!
      const transcripts = db.transcripts.getVariantTranscripts(otherVariant.id)
      expect(transcripts).toHaveLength(0)
    })
  })

  describe('switchSelectedTranscript', () => {
    it('should update is_selected flags', () => {
      db.transcripts.switchSelectedTranscript(variantId, 'NM_007299.4')

      const transcripts = db.transcripts.getVariantTranscripts(variantId)
      const selected = transcripts.find((t) => t.is_selected)
      expect(selected!.transcript_id).toBe('NM_007299.4')

      const deselected = transcripts.find((t) => t.transcript_id === 'NM_007294.4')
      expect(deselected!.is_selected).toBe(false)
    })

    it('should update denormalized fields on variants table', () => {
      db.transcripts.switchSelectedTranscript(variantId, 'NM_007299.4')

      const variants = db.variants.getVariants({ case_id: caseId }, 10)
      const v = variants.data[0]
      expect(v.transcript).toBe('NM_007299.4')
      expect(v.consequence).toBe('synonymous_variant')
      expect(v.cdna).toBe('c.456C>T')
      expect(v.aa_change).toBeNull()
    })

    it('should be atomic (transaction)', () => {
      // Switching to non-existent transcript should throw and leave state unchanged
      expect(() => db.transcripts.switchSelectedTranscript(variantId, 'FAKE_TRANSCRIPT')).toThrow()

      const transcripts = db.transcripts.getVariantTranscripts(variantId)
      const selected = transcripts.find((t) => t.is_selected)
      expect(selected!.transcript_id).toBe('NM_007294.4')
    })
  })
})
