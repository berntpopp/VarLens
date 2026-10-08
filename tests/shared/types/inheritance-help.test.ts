import { describe, expect, it } from 'vitest'
import { INHERITANCE_MODE_META } from '../../../src/shared/types/inheritance'

describe('inheritance mode help', () => {
  it('every mode says what it selects', () => {
    for (const meta of Object.values(INHERITANCE_MODE_META)) {
      expect(meta.help.length, meta.mode).toBeGreaterThan(20)
    }
  })

  it('the het modes say that assumed het calls are included', () => {
    for (const mode of [
      'heterozygous',
      'candidate_compound_het',
      'de_novo',
      'compound_het'
    ] as const) {
      expect(INHERITANCE_MODE_META[mode].help, mode).toMatch(/assumed het/)
    }
  })

  it('no trio mode claims more than it establishes', () => {
    expect(INHERITANCE_MODE_META.compound_het.label).not.toMatch(/confirmed/i)
    expect(INHERITANCE_MODE_META.de_novo.help).toMatch(/without a row/)
    expect(INHERITANCE_MODE_META.compound_het.help).toMatch(/without a row/)
  })
})
