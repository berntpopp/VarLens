import { describe, expect, it } from 'vitest'
import {
  alleleClass,
  mostSevereOf,
  projectToVarvis,
  type FuncMappingRow,
  type ImpactRow
} from '../../../../scripts/shortlist-sim/annotate/project-varvis'

const impact: ImpactRow[] = [
  { varvisFunc: 'missense_variant', impact: 'MODERATE', count: 100 },
  { varvisFunc: 'coding_transcript_intron_variant', impact: 'LOW', count: 80 },
  { varvisFunc: 'frameshift_truncation', impact: 'HIGH', count: 9 },
  { varvisFunc: 'frameshift_elongation', impact: 'HIGH', count: 6 },
  { varvisFunc: 'mnv', impact: 'HIGH', count: 7 },
  { varvisFunc: 'mnv', impact: 'MODERATE', count: 1 },
  { varvisFunc: 'stop_lost', impact: 'HIGH', count: 1 }
]
const row = (
  vepTerm: string,
  alleleClass: FuncMappingRow['alleleClass'],
  varvisFunc: string,
  count: number
) => ({
  vepTerm,
  alleleClass,
  varvisFunc,
  count
})
const mapping: FuncMappingRow[] = [
  row('missense_variant', 'snv', 'missense_variant', 50),
  row('missense_variant', 'snv', 'synonymous_variant', 2),
  row('intron_variant', 'snv', 'coding_transcript_intron_variant', 40),
  row('intron_variant', 'del', 'coding_transcript_intron_variant', 4),
  row('frameshift_variant', 'del', 'frameshift_truncation', 9),
  row('frameshift_variant', 'ins', 'frameshift_elongation', 6),
  row('missense_variant', 'mnv', 'mnv', 6),
  row('splice_region_variant&intron_variant', 'snv', 'splice_region_variant', 3),
  row('splice_region_variant&intron_variant', 'snv', 'coding_transcript_intron_variant', 3)
]
const snv = { ref: 'A', alt: 'G' }

describe('projectToVarvis', () => {
  it('uses the majority varvis term with support >= 5 and share >= 0.6, IMPACT from the varvis table', () => {
    expect(projectToVarvis('missense_variant', ['missense_variant'], mapping, impact, snv)).toEqual(
      {
        func: 'missense_variant',
        consequence: 'MODERATE',
        reason: 'empirical'
      }
    )
  })

  it('keeps insertion and deletion frameshifts apart by allele class', () => {
    const del = projectToVarvis('frameshift_variant', ['frameshift_variant'], mapping, impact, {
      ref: 'AT',
      alt: 'A'
    })
    const ins = projectToVarvis('frameshift_variant', ['frameshift_variant'], mapping, impact, {
      ref: 'A',
      alt: 'AT'
    })
    expect([del.func, ins.func]).toEqual(['frameshift_truncation', 'frameshift_elongation'])
  })

  it('falls back to pooled rows when the allele class lacks support', () => {
    const p = projectToVarvis('intron_variant', ['intron_variant'], mapping, impact, {
      ref: 'AT',
      alt: 'A'
    })
    expect(p).toMatchObject({ func: 'coding_transcript_intron_variant', reason: 'empirical' })
  })

  it('maps an equal-length multi-base substitution to mnv only through mnv rows', () => {
    const mnv = { ref: 'AC', alt: 'GT' }
    expect(projectToVarvis('missense_variant', ['missense_variant'], mapping, impact, mnv)).toEqual(
      {
        func: 'mnv',
        consequence: 'HIGH',
        reason: 'empirical'
      }
    )
    expect(projectToVarvis('stop_gained', ['stop_gained'], mapping, impact, mnv).reason).toBe(
      'unmapped'
    )
  })

  it('returns identity for a verbatim varvis term and unmapped otherwise', () => {
    expect(projectToVarvis('stop_lost', ['stop_lost'], mapping, impact, snv)).toEqual({
      func: 'stop_lost',
      consequence: 'HIGH',
      reason: 'identity'
    })
    expect(
      projectToVarvis('coding_sequence_variant', ['coding_sequence_variant'], mapping, impact, snv)
        .reason
    ).toBe('unmapped')
  })

  it('does not pick a term without a clear majority (share < 0.6)', () => {
    const p = projectToVarvis(
      'splice_region_variant',
      ['splice_region_variant', 'intron_variant'],
      mapping,
      impact,
      snv
    )
    // No combo majority; the severe-term fallback over snv rows has the same tie → identity applies.
    expect(p.reason).not.toBe('empirical')
  })
})

describe('helpers', () => {
  it('classifies alleles after trimming', () => {
    expect(alleleClass('A', 'G')).toBe('snv')
    expect(alleleClass('GAC', 'GTT')).toBe('mnv')
    expect(alleleClass('A', 'AT')).toBe('ins')
    expect(alleleClass('AT', 'A')).toBe('del')
    expect(alleleClass('ATG', 'C')).toBe('delins')
  })
  it('orders VEP terms by severity', () => {
    expect(mostSevereOf(['intron_variant', 'splice_region_variant'])).toBe('splice_region_variant')
  })
})
