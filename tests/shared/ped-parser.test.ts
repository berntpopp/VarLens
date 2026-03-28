import { describe, it, expect } from 'vitest'
import { parsePedFile } from '../../src/shared/utils/ped-parser'

const TRIO_PED = `#Family_ID\tIndividual_ID\tPaternal_ID\tMaternal_ID\tSex\tPhenotype
FAM001\tproband\tfather\tmother\t1\t2
FAM001\tfather\t0\t0\t1\t1
FAM001\tmother\t0\t0\t2\t1`

describe('parsePedFile', () => {
  it('parses a standard trio PED', () => {
    const entries = parsePedFile(TRIO_PED)
    expect(entries).toHaveLength(3)
  })

  it('maps sex correctly', () => {
    const entries = parsePedFile(TRIO_PED)
    expect(entries.find((e) => e.individualId === 'father')?.sex).toBe('male')
    expect(entries.find((e) => e.individualId === 'mother')?.sex).toBe('female')
  })

  it('maps phenotype to affected status', () => {
    const entries = parsePedFile(TRIO_PED)
    expect(entries.find((e) => e.individualId === 'proband')?.affectedStatus).toBe('affected')
    expect(entries.find((e) => e.individualId === 'father')?.affectedStatus).toBe('unaffected')
  })

  it('parses paternal/maternal IDs', () => {
    const entries = parsePedFile(TRIO_PED)
    const proband = entries.find((e) => e.individualId === 'proband')!
    expect(proband.paternalId).toBe('father')
    expect(proband.maternalId).toBe('mother')
  })

  it('sets null for founder parents (0)', () => {
    const entries = parsePedFile(TRIO_PED)
    const father = entries.find((e) => e.individualId === 'father')!
    expect(father.paternalId).toBeNull()
    expect(father.maternalId).toBeNull()
  })

  it('skips comment lines and blank lines', () => {
    const input = '# comment\n\nFAM001\tp\t0\t0\t0\t0\n'
    const entries = parsePedFile(input)
    expect(entries).toHaveLength(1)
  })

  it('handles unknown sex (0)', () => {
    const input = 'FAM001\tp\t0\t0\t0\t2\n'
    const entries = parsePedFile(input)
    expect(entries[0].sex).toBe('unknown')
  })

  it('handles unknown phenotype (-9)', () => {
    const input = 'FAM001\tp\t0\t0\t1\t-9\n'
    const entries = parsePedFile(input)
    expect(entries[0].affectedStatus).toBe('unknown')
  })
})
