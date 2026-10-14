import { describe, expect, it } from 'vitest'
import { phasedAltSide, phaseRelation } from '../../../src/shared/utils/phasing'

describe('phasing (#586)', () => {
  it('reads the haplotype side of the ALT in phased het calls only', () => {
    expect(phasedAltSide('1|0')).toBe(0)
    expect(phasedAltSide('0|1')).toBe(1)
    // A split 1|2 keeps each ALT on its own side.
    expect(phasedAltSide('1|.')).toBe(0)
    expect(phasedAltSide('.|1')).toBe(1)
    for (const gt of ['0/1', '1|1', '0|0', '1', null, './.']) expect(phasedAltSide(gt)).toBeNull()
  })

  it('compares only calls of one phase set on one chromosome', () => {
    const call = (gt: string, ps: number | null, chr = '1') => ({ chr, gt_num: gt, ps })
    expect(phaseRelation(call('0|1', 5), call('1|0', 5))).toBe('trans')
    expect(phaseRelation(call('0|1', 5), call('.|1', 5))).toBe('cis')
    expect(phaseRelation(call('0|1', 5), call('1|0', 6))).toBeNull()
    expect(phaseRelation(call('0|1', null), call('1|0', null))).toBeNull()
    expect(phaseRelation(call('0|1', 5), call('1|0', 5, '2'))).toBeNull()
  })
})
