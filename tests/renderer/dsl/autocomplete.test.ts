import { describe, it, expect } from 'vitest'
import { getAutocompleteSuggestions } from '../../../src/renderer/src/dsl/autocomplete'

describe('getAutocompleteSuggestions', () => {
  it('suggests columns when input is empty', () => {
    const suggestions = getAutocompleteSuggestions('')
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].category).toBe('hint')
  })

  it('suggests matching columns for partial input', () => {
    const suggestions = getAutocompleteSuggestions('gno')
    expect(suggestions.some((s) => s.value === 'gnomad_af')).toBe(true)
  })

  it('suggests operators after column:', () => {
    const suggestions = getAutocompleteSuggestions('gnomad_af:')
    expect(suggestions.some((s) => s.value === '<')).toBe(true)
    expect(suggestions.some((s) => s.value === '>=')).toBe(true)
    // Should not suggest text-only operators for numeric columns
    expect(suggestions.some((s) => s.value === '~')).toBe(false)
  })

  it('suggests common values after column:op:', () => {
    const suggestions = getAutocompleteSuggestions('gnomad_af:<:')
    expect(suggestions.some((s) => s.value === '0.01')).toBe(true)
  })

  it('suggests AND/OR after complete expression', () => {
    const suggestions = getAutocompleteSuggestions('gnomad_af:<:0.01 ')
    expect(suggestions.some((s) => s.value === 'AND')).toBe(true)
    expect(suggestions.some((s) => s.value === 'OR')).toBe(true)
  })

  it('suggests columns after combinator', () => {
    const suggestions = getAutocompleteSuggestions('gnomad_af:<:0.01 AND ')
    expect(suggestions.some((s) => s.category === 'column')).toBe(true)
  })

  it('suggests presets when input starts with @', () => {
    const presetNames = ['rare_pathogenic', 'lgd', 'high_quality']
    const suggestions = getAutocompleteSuggestions('@', presetNames)
    expect(suggestions.some((s) => s.value === '@rare_pathogenic')).toBe(true)
  })

  it('filters preset suggestions by partial match', () => {
    const presetNames = ['rare_pathogenic', 'lgd', 'high_quality']
    const suggestions = getAutocompleteSuggestions('@rar', presetNames)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].value).toBe('@rare_pathogenic')
  })

  it('suggests text operators for gene_symbol', () => {
    const suggestions = getAutocompleteSuggestions('gene_symbol:')
    expect(suggestions.some((s) => s.value === '~')).toBe(true)
    expect(suggestions.some((s) => s.value === '=')).toBe(true)
  })

  it('lists every in-scope field on an empty bar so a query can be built by picking', () => {
    const fields = (scope: 'case' | 'cohort'): string[] =>
      getAutocompleteSuggestions('', [], scope)
        .filter((s) => s.category === 'column')
        .map((s) => s.value)
    expect(fields('case')).toEqual(
      expect.arrayContaining(['gnomad_af', 'omim_mim_number', 'gt_num'])
    )
    expect(fields('case')).not.toContain('carrier_count')
    expect(fields('cohort')).toEqual(
      expect.arrayContaining(['gnomad_af', 'carrier_count', 'hom_count'])
    )
    expect(fields('cohort')).not.toEqual(expect.arrayContaining(['qual']))
    expect(
      fields('cohort').some((f) => ['qual', 'gt_num', 'hpo_sim_score', 'moi'].includes(f))
    ).toBe(false)
  })

  it('offers no operators for a case-only field in the cohort view', () => {
    expect(getAutocompleteSuggestions('gt_num:', [], 'cohort')).toEqual([])
    expect(getAutocompleteSuggestions('carrier_count:', [], 'cohort').length).toBeGreaterThan(0)
  })

  it('explains missing-value behaviour on operators', () => {
    const ops = getAutocompleteSuggestions('cadd:')
    expect(ops.find((s) => s.value === '>=')?.description).toContain('also keeps variants with no')
    expect(ops.find((s) => s.value === '!=')?.description).toContain('never match')
  })

  it('hints how to enter a value when there are no common values', () => {
    const [hint] = getAutocompleteSuggestions('gene_symbol:=:')
    expect(hint.category).toBe('hint')
    expect(hint.label).toContain('press Enter')
  })
})

describe('getAutocompleteSuggestions — case info.<KEY> fields (#596, #538)', () => {
  const fields = [
    { key: 'REVEL', source: 'CSQ:REVEL_score' },
    { key: 'AltAF_Index', source: 'JSON:AltAF-Index' }
  ]

  it('lists the case keys with their source when typing info. or a key', () => {
    const byPrefix = getAutocompleteSuggestions('info.', [], 'case', fields)
    expect(byPrefix.map((s) => s.value)).toEqual(['info.REVEL', 'info.AltAF_Index'])
    expect(byPrefix[0]).toMatchObject({ category: 'column', description: 'CSQ:REVEL_score' })
    const byKey = getAutocompleteSuggestions('rev', [], 'case', fields)
    expect(byKey.some((s) => s.value === 'info.REVEL')).toBe(true)
  })

  it('does not flood the empty picker or offer INFO keys in the cohort view', () => {
    expect(
      getAutocompleteSuggestions('', [], 'case', fields).some((s) => s.value.startsWith('info.'))
    ).toBe(false)
    expect(getAutocompleteSuggestions('info.', [], 'cohort', fields)).toEqual([])
  })

  it('offers the INFO operators for an info key', () => {
    const ops = getAutocompleteSuggestions('info.REVEL:', [], 'case', fields).map((s) => s.value)
    expect(ops).toEqual(expect.arrayContaining(['=', '>=', '~']))
  })

  it('explains a key this case does not have', () => {
    const [hint] = getAutocompleteSuggestions('info.CADD_RAW:', [], 'case', fields)
    expect(hint.category).toBe('hint')
    expect(hint.label).toMatch(/CADD_RAW is not an imported field of this case/)
  })

  it('marks Flag and list fields as not comparable, with the reason', () => {
    const typed = [
      { key: 'DB', source: 'INFO:DB', type: 'Flag', number: '0' },
      { key: 'AC', source: 'INFO:AC', type: 'Integer', number: 'A' },
      { key: 'DP', source: 'INFO:DP', type: 'Integer', number: '1' }
    ]
    const [db] = getAutocompleteSuggestions('info.DB', [], 'case', typed)
    expect(db.description).toMatch(/^INFO:DB · Flag field/)
    const [hint] = getAutocompleteSuggestions('info.AC:', [], 'case', typed)
    expect(hint).toMatchObject({
      category: 'hint',
      label: expect.stringMatching(/AC: List field \(Number=A\)/)
    })
    const dp = getAutocompleteSuggestions('info.DP:', [], 'case', typed)
    expect(dp.some((s) => s.category === 'hint')).toBe(false)
  })

  it('stays silent about unknown keys when the case has no field dictionary', () => {
    const suggestions = getAutocompleteSuggestions('info.DP:', [], 'case', [])
    expect(suggestions.some((s) => s.category === 'hint')).toBe(false)
    expect(suggestions.some((s) => s.value === '>=')).toBe(true)
  })
})
