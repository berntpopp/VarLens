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

  it('limits suggestions to 10', () => {
    const suggestions = getAutocompleteSuggestions('')
    expect(suggestions.length).toBeLessThanOrEqual(10)
  })
})
