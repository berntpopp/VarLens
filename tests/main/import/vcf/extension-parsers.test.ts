import { describe, it, expect } from 'vitest'
import {
  extractSvFields,
  extractCnvFields,
  extractStrFields
} from '../../../../src/main/import/vcf/extension-parsers'

describe('extractSvFields', () => {
  it('extracts Sniffles2 SV fields', () => {
    const info = new Map<string, string>([
      ['SVTYPE', 'DEL'],
      ['SVLEN', '-5000'],
      ['END', '1005000'],
      ['SUPPORT', '15'],
      ['COVERAGE', '20,18,22,19,21'],
      ['STRAND', '+-'],
      ['STDEV_LEN', '10.5'],
      ['STDEV_POS', '3.2'],
      ['VAF', '0.75'],
      ['PRECISE', '']
    ])
    const formatRaw = new Map<string, string>([
      ['DR', '5'],
      ['DV', '15']
    ])
    const result = extractSvFields(info, formatRaw)
    expect(result.sv_is_precise).toBe(1)
    expect(result.support).toBe(15)
    expect(result.strand).toBe('+-')
    expect(result.stdev_len).toBeCloseTo(10.5)
    expect(result.vaf).toBeCloseTo(0.75)
    expect(result.dr).toBe(5)
    expect(result.dv).toBe(15)
  })

  it('handles IMPRECISE flag', () => {
    const info = new Map<string, string>([
      ['IMPRECISE', ''],
      ['SVTYPE', 'INV']
    ])
    const result = extractSvFields(info, new Map())
    expect(result.sv_is_precise).toBe(0)
  })
})

describe('extractCnvFields', () => {
  it('extracts Spectre CNV fields', () => {
    const info = new Map<string, string>([
      ['CN', '1'],
      ['SVTYPE', 'DEL']
    ])
    const formatRaw = new Map<string, string>([
      ['HO', '0.45,0.55'],
      ['GQ', '30'],
      ['CN', '1']
    ])
    const result = extractCnvFields(info, formatRaw)
    expect(result.copy_number).toBe(1)
    expect(result.copy_number_quality).toBe(30)
    expect(result.homozygosity_ref).toBeCloseTo(0.45)
    expect(result.homozygosity_alt).toBeCloseTo(0.55)
  })

  it('prefers FORMAT/CN over INFO/CN', () => {
    const info = new Map<string, string>([['CN', '3']])
    const formatRaw = new Map<string, string>([['CN', '1']])
    const result = extractCnvFields(info, formatRaw)
    expect(result.copy_number).toBe(1)
  })
})

describe('extractStrFields', () => {
  it('extracts Straglr STR fields', () => {
    const info = new Map<string, string>([
      ['REPID', 'ATXN3'],
      ['VARID', 'ATXN3'],
      ['RU', 'CTG'],
      ['DisplayRU', 'CAG'],
      ['REF', '11'],
      ['RL', '33'],
      ['STR_STATUS', 'normal,normal'],
      ['STR_NORMAL_MAX', '44'],
      ['STR_PATHOLOGIC_MIN', '60'],
      ['Disease', 'MJD'],
      ['InheritanceMode', 'AD'],
      ['RankScore', '1:10'],
      ['SourceDisplay', 'GeneReviews']
    ])
    const formatRaw = new Map<string, string>([
      ['REPCN', '24/15'],
      ['REPCI', '24-24/15-15'],
      ['SO', 'SPANNING/SPANNING'],
      ['LC', '3']
    ])
    const result = extractStrFields(info, formatRaw)
    expect(result.repeat_id).toBe('ATXN3')
    expect(result.repeat_unit).toBe('CTG')
    expect(result.display_repeat_unit).toBe('CAG')
    expect(result.ref_copies).toBe(11)
    expect(result.alt_copies).toBe('24/15')
    expect(result.str_status).toBe('normal,normal')
    expect(result.normal_max).toBe(44)
    expect(result.pathologic_min).toBe(60)
    expect(result.disease).toBe('MJD')
    expect(result.inheritance_mode).toBe('AD')
    expect(result.locus_coverage).toBe(3)
    expect(result.support_type).toBe('SPANNING/SPANNING')
  })

  it('handles full_mutation status', () => {
    const info = new Map<string, string>([
      ['STR_STATUS', 'full_mutation'],
      ['REPID', 'CSTB']
    ])
    const result = extractStrFields(info, new Map())
    expect(result.str_status).toBe('full_mutation')
    expect(result.repeat_id).toBe('CSTB')
  })
})
