import { describe, expect, it } from 'vitest'

import {
  deriveCaseName,
  legacyCaseName,
  resolveCaseName
} from '../../../src/shared/utils/case-name'

describe('deriveCaseName', () => {
  it.each([
    ['SIM-0001.vcf.gz', 'SIM-0001'],
    ['SIM-0001.vcf', 'SIM-0001'],
    ['SIM-0001.json.gz', 'SIM-0001'],
    ['SIM-0001.json', 'SIM-0001'],
    ['SIM-0001.VCF.GZ', 'SIM-0001'],
    ['SIM-0001.Json', 'SIM-0001'],
    // Only the trailing extension chain is removed, never an inner ".vcf".
    ['family.vcf.trio.vcf.gz', 'family.vcf.trio'],
    ['plain-name', 'plain-name'],
    ['archive.gz', 'archive']
  ])('%s → %s', (fileName, expected) => {
    expect(deriveCaseName(fileName)).toBe(expected)
  })

  it('removes the optional strip text after the extensions', () => {
    expect(deriveCaseName('HG001_final.vcf.gz', '_final')).toBe('HG001')
    expect(deriveCaseName('HG001 final.json', 'final')).toBe('HG001')
    expect(deriveCaseName('HG001.vcf.gz', '')).toBe('HG001')
  })
})

describe('legacyCaseName', () => {
  it('reproduces the name older versions gave a file (inner ".vcf" kept)', () => {
    expect(legacyCaseName('SIM-0001.vcf.gz')).toBe('SIM-0001.vcf')
    expect(legacyCaseName('SIM-0001.vcf')).toBe('SIM-0001.vcf')
    expect(legacyCaseName('SIM-0001.json.gz')).toBe('SIM-0001')
    expect(legacyCaseName('HG001_final.vcf.gz', '_final')).toBe('HG001.vcf')
  })
})

describe('resolveCaseName', () => {
  const existsIn =
    (...names: string[]) =>
    (name: string) =>
      names.includes(name)

  it('uses the derived name for a new case', () => {
    expect(resolveCaseName('X.vcf.gz', undefined, existsIn())).toEqual({
      caseName: 'X',
      isDuplicate: false
    })
  })

  it('flags an existing case with the derived name', () => {
    expect(resolveCaseName('X.vcf.gz', undefined, existsIn('X'))).toEqual({
      caseName: 'X',
      isDuplicate: true
    })
  })

  it('matches a case imported before ".vcf" was stripped, under its existing name', () => {
    expect(resolveCaseName('X.vcf.gz', undefined, existsIn('X.vcf'))).toEqual({
      caseName: 'X.vcf',
      isDuplicate: true
    })
  })

  it('prefers the exact new-style match when both names exist', () => {
    expect(resolveCaseName('X.vcf.gz', undefined, existsIn('X', 'X.vcf'))).toEqual({
      caseName: 'X',
      isDuplicate: true
    })
  })
})
