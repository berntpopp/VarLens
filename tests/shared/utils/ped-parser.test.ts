import { describe, expect, it } from 'vitest'
import { derivePedRoles, parsePed, pedFamilies } from '../../../src/shared/utils/ped-parser'

const TRIO = [
  '# family individual father mother sex phenotype',
  'FAM1\tkid\tdad\tmom\t1\t2',
  'FAM1 dad 0 0 1 1',
  '',
  'FAM1   mom   0   0   2   1  ',
  'FAM1\tsis\tdad\tmom\t2\t1'
].join('\n')

describe('parsePed', () => {
  it('parses tabs, spaces, comments and blank lines', () => {
    const { individuals, errors } = parsePed(TRIO)
    expect(errors).toEqual([])
    expect(individuals.map((i) => i.individualId)).toEqual(['kid', 'dad', 'mom', 'sis'])
    expect(individuals[0]).toEqual({
      familyId: 'FAM1',
      individualId: 'kid',
      fatherId: 'dad',
      motherId: 'mom',
      sex: 'male',
      phenotype: 'affected',
      line: 2
    })
    expect(individuals[1]).toMatchObject({ fatherId: null, motherId: null, line: 3 })
  })

  it('handles CRLF, extra genotype columns and -9 phenotype', () => {
    const { individuals, errors } = parsePed('F a 0 0 0 -9 A A C T\r\nF b 0 0 1 0\r\n')
    expect(errors).toEqual([])
    expect(individuals.map((i) => [i.sex, i.phenotype])).toEqual([
      ['unknown', 'unknown'],
      ['male', 'unknown']
    ])
  })

  it('reports line-numbered errors and keeps valid rows', () => {
    const { individuals, errors } = parsePed(
      ['F a 0 0 1', 'F b 0 0 3 1', 'F c 0 0 1 x', 'F d d 0 1 1', 'F e 0 0 1 1', 'F e 0 0 2 1'].join(
        '\n'
      )
    )
    expect(errors).toEqual([
      { line: 1, message: 'expected 6 columns, found 5' },
      { line: 2, message: 'invalid sex "3" (use 0, 1 or 2)' },
      { line: 3, message: 'invalid phenotype "x" (use 0, -9, 1 or 2)' },
      { line: 4, message: 'd is listed as its own parent' },
      { line: 6, message: 'duplicate individual e in family F (first on line 5)' }
    ])
    expect(individuals.map((i) => i.individualId)).toEqual(['d', 'e'])
  })

  it('flags parents whose sex contradicts their role', () => {
    const { errors } = parsePed('F kid mom dad 1 2\nF mom 0 0 2 1\nF dad 0 0 1 1')
    expect(errors).toEqual([
      { line: 1, message: 'father mom of kid has sex female' },
      { line: 1, message: 'mother dad of kid has sex male' }
    ])
  })

  it('returns nothing for empty input', () => {
    expect(parsePed('\n# only a comment\n')).toEqual({ individuals: [], errors: [] })
  })
})

describe('pedFamilies / derivePedRoles', () => {
  it('lists families in file order', () => {
    const { individuals } = parsePed('B x 0 0 1 1\nA y 0 0 1 1\nB z 0 0 1 1')
    expect(pedFamilies(individuals)).toEqual(['B', 'A'])
  })

  it('derives trio roles plus siblings', () => {
    const roles = derivePedRoles(parsePed(TRIO).individuals)
    expect(Object.fromEntries(roles)).toEqual({
      kid: 'proband',
      dad: 'father',
      mom: 'mother',
      sis: 'sibling'
    })
  })

  it('picks the affected child even when listed after an unaffected one', () => {
    const roles = derivePedRoles(
      parsePed('F sib dad mom 1 1\nF dad 0 0 1 2\nF kid dad mom 2 2\nF mom 0 0 2 1\nF x 0 0 0 0')
        .individuals
    )
    expect(Object.fromEntries(roles)).toEqual({
      sib: 'sibling',
      dad: 'father',
      kid: 'proband',
      mom: 'mother',
      x: 'other'
    })
  })

  it('falls back to the first individual when nobody is affected or has parents', () => {
    const roles = derivePedRoles(parsePed('F a 0 0 1 1\nF b 0 0 2 1').individuals)
    expect(Object.fromEntries(roles)).toEqual({ a: 'proband', b: 'other' })
  })
})
