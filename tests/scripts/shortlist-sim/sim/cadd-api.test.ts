import { describe, expect, it } from 'vitest'
import { parseCaddBody } from '../../../../scripts/shortlist-sim/sim/cadd-api'

describe('parseCaddBody', () => {
  it('reads PHRED from the first record and maps [] to null', () => {
    expect(parseCaddBody([{ PHRED: '25.0', Chrom: '17' }])).toBe(25)
    expect(parseCaddBody([])).toBeNull()
    expect(parseCaddBody({ error: 'x' })).toBeNull()
  })
})
