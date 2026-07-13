import { describe, it, expect } from 'vitest'
import {
  mergeTranscripts,
  normalizeTranscriptId
} from '../../../src/renderer/src/utils/mergeTranscripts'
import type { TranscriptAnnotation } from '../../../src/shared/types/transcript'
import type { VepTranscriptConsequence } from '../../../src/main/services/api/schemas/vep-response'

/** Helper to build a minimal DB transcript row */
function makeDbRow(overrides: Partial<TranscriptAnnotation> = {}): TranscriptAnnotation {
  return {
    id: 1,
    variant_id: 100,
    transcript_id: 'ENST00000357654',
    gene_symbol: 'BRCA1',
    consequence: 'MODERATE',
    func: 'missense_variant',
    cdna: 'c.123A>G',
    aa_change: 'p.Arg41Gly',
    hpo_sim_score: null,
    moi: null,
    is_selected: false,
    is_mane_select: null,
    is_canonical: null,
    ...overrides
  }
}

/** Helper to build a minimal VEP transcript row */
function makeVepRow(overrides: Partial<VepTranscriptConsequence> = {}): VepTranscriptConsequence {
  return {
    transcript_id: 'ENST00000357654.9',
    gene_symbol: 'BRCA1',
    consequence_terms: ['missense_variant'],
    impact: 'MODERATE',
    biotype: 'protein_coding',
    ...overrides
  }
}

describe('normalizeTranscriptId', () => {
  it('strips numeric version suffix', () => {
    expect(normalizeTranscriptId('ENST00000357654.9')).toBe('ENST00000357654')
  })

  it('strips multi-digit version', () => {
    expect(normalizeTranscriptId('ENST00000357654.15')).toBe('ENST00000357654')
  })

  it('returns as-is when no version suffix', () => {
    expect(normalizeTranscriptId('ENST00000357654')).toBe('ENST00000357654')
  })

  it('returns as-is when suffix is not numeric', () => {
    expect(normalizeTranscriptId('NM_007294.abc')).toBe('NM_007294.abc')
  })

  it('handles empty string', () => {
    expect(normalizeTranscriptId('')).toBe('')
  })
})

describe('mergeTranscripts', () => {
  it('returns empty array for empty inputs', () => {
    expect(mergeTranscripts([], [])).toEqual([])
  })

  it('returns DB-only rows with source "imported"', () => {
    const db = [makeDbRow({ transcript_id: 'ENST00000357654' })]
    const result = mergeTranscripts(db, [])

    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('imported')
    expect(result[0].transcript_id).toBe('ENST00000357654')
    expect(result[0]._dbRow).toBe(db[0])
    expect(result[0]._vepRow).toBeNull()
  })

  it('returns VEP-only rows with source "vep"', () => {
    const vep = [makeVepRow({ transcript_id: 'ENST00000222222.3' })]
    const result = mergeTranscripts([], vep)

    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('vep')
    expect(result[0].transcript_id).toBe('ENST00000222222')
    expect(result[0]._dbRow).toBeNull()
    expect(result[0]._vepRow).toBe(vep[0])
  })

  it('merges overlapping transcript IDs as "both"', () => {
    const db = [
      makeDbRow({
        transcript_id: 'ENST00000357654',
        cdna: 'c.123A>G',
        aa_change: 'p.Arg41Gly'
      })
    ]
    const vep = [
      makeVepRow({
        transcript_id: 'ENST00000357654.9',
        impact: 'MODERATE',
        consequence_terms: ['missense_variant'],
        biotype: 'protein_coding'
      })
    ]
    const result = mergeTranscripts(db, vep)

    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('both')
    // DB fields preserved
    expect(result[0].cdna).toBe('c.123A>G')
    expect(result[0].aa_change).toBe('p.Arg41Gly')
    // VEP fields merged
    expect(result[0].impact).toBe('MODERATE')
    expect(result[0].consequence_terms).toEqual(['missense_variant'])
    expect(result[0].biotype).toBe('protein_coding')
    expect(result[0]._dbRow).toBe(db[0])
    expect(result[0]._vepRow).toBe(vep[0])
  })

  describe('func (SO term) propagation', () => {
    it('surfaces the DB row func (SO term) for a DB-only ("imported") row', () => {
      const db = [makeDbRow({ consequence: 'MODERATE', func: 'missense_variant' })]
      const result = mergeTranscripts(db, [])

      expect(result[0].consequence).toBe('MODERATE')
      expect(result[0].func).toBe('missense_variant')
    })

    it('does not lose information: func stays null (not dropped) when the DB row has none', () => {
      const db = [makeDbRow({ func: null })]
      const result = mergeTranscripts(db, [])

      expect(result[0].func).toBeNull()
    })

    it('joins VEP consequence_terms into func for a VEP-only row', () => {
      const vep = [makeVepRow({ consequence_terms: ['missense_variant', 'splice_region_variant'] })]
      const result = mergeTranscripts([], vep)

      expect(result[0].func).toBe('missense_variant, splice_region_variant')
    })

    it('sets func to null for a VEP-only row with no consequence_terms', () => {
      const vep = [makeVepRow({ consequence_terms: [] })]
      const result = mergeTranscripts([], vep)

      expect(result[0].func).toBeNull()
    })

    it('overwrites DB func with fresh VEP consequence_terms on merge ("both")', () => {
      const db = [makeDbRow({ transcript_id: 'ENST00000357654', func: 'missense_variant' })]
      const vep = [
        makeVepRow({
          transcript_id: 'ENST00000357654.9',
          consequence_terms: ['missense_variant', 'NMD_transcript_variant']
        })
      ]
      const result = mergeTranscripts(db, vep)

      expect(result[0].source).toBe('both')
      expect(result[0].func).toBe('missense_variant, NMD_transcript_variant')
    })

    it('preserves DB func on merge when VEP provides no consequence_terms', () => {
      const db = [makeDbRow({ transcript_id: 'ENST00000357654', func: 'missense_variant' })]
      const vep = [
        makeVepRow({
          transcript_id: 'ENST00000357654.9',
          consequence_terms: []
        })
      ]
      const result = mergeTranscripts(db, vep)

      expect(result[0].source).toBe('both')
      expect(result[0].func).toBe('missense_variant')
    })
  })

  it('matches version-stripped IDs (ENST00000357654.9 ≈ ENST00000357654)', () => {
    const db = [makeDbRow({ transcript_id: 'ENST00000357654' })]
    const vep = [makeVepRow({ transcript_id: 'ENST00000357654.9' })]
    const result = mergeTranscripts(db, vep)

    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('both')
  })

  it('keeps distinct transcripts separate', () => {
    const db = [makeDbRow({ transcript_id: 'ENST00000111111' })]
    const vep = [makeVepRow({ transcript_id: 'ENST00000222222.5' })]
    const result = mergeTranscripts(db, vep)

    expect(result).toHaveLength(2)
    const sources = result.map((r) => r.source)
    expect(sources).toContain('imported')
    expect(sources).toContain('vep')
  })

  describe('sort order', () => {
    it('puts selected transcript first', () => {
      const db = [
        makeDbRow({ transcript_id: 'ENST00000111111', is_selected: false }),
        makeDbRow({ id: 2, transcript_id: 'ENST00000222222', is_selected: true })
      ]
      const result = mergeTranscripts(db, [])

      expect(result[0].transcript_id).toBe('ENST00000222222')
      expect(result[0].is_selected).toBe(true)
    })

    it('puts MANE before non-MANE', () => {
      const vep = [
        makeVepRow({ transcript_id: 'ENST00000111111.1', impact: 'MODERATE' }),
        makeVepRow({
          transcript_id: 'ENST00000222222.2',
          impact: 'MODERATE',
          mane_select: 'NM_007294.4'
        })
      ]
      const result = mergeTranscripts([], vep)

      expect(result[0].transcript_id).toBe('ENST00000222222')
      expect(result[0].is_mane_select).toBe(true)
    })

    it('puts canonical before non-canonical', () => {
      const vep = [
        makeVepRow({ transcript_id: 'ENST00000111111.1', impact: 'MODERATE' }),
        makeVepRow({
          transcript_id: 'ENST00000222222.2',
          impact: 'MODERATE',
          canonical: 1
        })
      ]
      const result = mergeTranscripts([], vep)

      expect(result[0].transcript_id).toBe('ENST00000222222')
      expect(result[0].is_canonical).toBe(true)
    })

    it('sorts by impact severity (HIGH before MODERATE before LOW before MODIFIER)', () => {
      const vep = [
        makeVepRow({ transcript_id: 'ENST00000111111.1', impact: 'MODIFIER' }),
        makeVepRow({ transcript_id: 'ENST00000222222.2', impact: 'HIGH' }),
        makeVepRow({ transcript_id: 'ENST00000333333.3', impact: 'LOW' }),
        makeVepRow({ transcript_id: 'ENST00000444444.4', impact: 'MODERATE' })
      ]
      const result = mergeTranscripts([], vep)

      expect(result.map((r) => r.impact)).toEqual(['HIGH', 'MODERATE', 'LOW', 'MODIFIER'])
    })

    it('sorts DB-only rows by their canonical consequence impact', () => {
      const db = [
        makeDbRow({ id: 1, transcript_id: 'A_MODERATE', consequence: 'MODERATE' }),
        makeDbRow({ id: 2, transcript_id: 'Z_HIGH', consequence: 'HIGH' })
      ]

      const result = mergeTranscripts(db, [])

      expect(result.map((row) => row.transcript_id)).toEqual(['Z_HIGH', 'A_MODERATE'])
      expect(result.map((row) => row.impact)).toEqual(['HIGH', 'MODERATE'])
    })

    it('sorts alphabetically by transcript_id as tiebreaker', () => {
      const vep = [
        makeVepRow({ transcript_id: 'ENST00000333333.1', impact: 'MODERATE' }),
        makeVepRow({ transcript_id: 'ENST00000111111.1', impact: 'MODERATE' }),
        makeVepRow({ transcript_id: 'ENST00000222222.1', impact: 'MODERATE' })
      ]
      const result = mergeTranscripts([], vep)

      expect(result.map((r) => r.transcript_id)).toEqual([
        'ENST00000111111',
        'ENST00000222222',
        'ENST00000333333'
      ])
    })
  })

  it('fills MANE/canonical from VEP when DB had null', () => {
    const db = [
      makeDbRow({
        transcript_id: 'ENST00000357654',
        is_mane_select: null,
        is_canonical: null
      })
    ]
    const vep = [
      makeVepRow({
        transcript_id: 'ENST00000357654.9',
        mane_select: 'NM_007294.4',
        canonical: 1
      })
    ]
    const result = mergeTranscripts(db, vep)

    expect(result[0].is_mane_select).toBe(true)
    expect(result[0].is_canonical).toBe(true)
  })

  it('does not overwrite existing DB MANE/canonical values', () => {
    const db = [
      makeDbRow({
        transcript_id: 'ENST00000357654',
        is_mane_select: false,
        is_canonical: false
      })
    ]
    const vep = [
      makeVepRow({
        transcript_id: 'ENST00000357654.9',
        mane_select: 'NM_007294.4',
        canonical: 1
      })
    ]
    const result = mergeTranscripts(db, vep)

    // DB had explicit false values, so they should be preserved (not null)
    expect(result[0].is_mane_select).toBe(false)
    expect(result[0].is_canonical).toBe(false)
  })
})
