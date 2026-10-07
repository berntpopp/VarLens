import { describe, expect, it } from 'vitest'
import {
  IMPORTABLE_VARIANT_EXTENSIONS,
  isImportableVariantFileName
} from '../../../src/shared/utils/importable-file'

describe('isImportableVariantFileName', () => {
  it.each(['case.vcf', 'case.vcf.gz', 'case.json', 'case.json.gz'])('accepts %s', (name) => {
    expect(isImportableVariantFileName(name)).toBe(true)
  })

  it('accepts any gzip name because the format is sniffed from content', () => {
    expect(isImportableVariantFileName('case.gz')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(isImportableVariantFileName('CASE.VCF')).toBe(true)
    expect(isImportableVariantFileName('Case.Vcf.GZ')).toBe(true)
    expect(isImportableVariantFileName('CASE.JSON')).toBe(true)
  })

  it.each([
    'case.vcf.gz.tbi',
    'case.vcf.gz.csi',
    'case.vcf.bgz',
    'case.bed',
    'archive.zip',
    'notes.txt',
    'vcf',
    'json.bak'
  ])('rejects %s', (name) => {
    expect(isImportableVariantFileName(name)).toBe(false)
  })

  it('rejects a bare extension with no base name', () => {
    expect(isImportableVariantFileName('.vcf')).toBe(false)
    expect(isImportableVariantFileName('.gz')).toBe(false)
  })

  it('exposes the picker extensions the predicate is built from', () => {
    expect([...IMPORTABLE_VARIANT_EXTENSIONS]).toEqual(['vcf', 'json', 'gz'])
    for (const extension of IMPORTABLE_VARIANT_EXTENSIONS) {
      expect(isImportableVariantFileName(`case.${extension}`)).toBe(true)
    }
  })
})
