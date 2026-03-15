import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { useDslSearch } from '../../../src/renderer/src/composables/useDslSearch'

// Mock @vueuse/core debounce to execute immediately in tests
vi.mock('@vueuse/core', () => ({
  useDebounceFn: (fn: () => void) => fn
}))

describe('useDslSearch', () => {
  const presetNames = () => ['rare_pathogenic', 'high_quality']

  it('starts in FTS mode with empty input', () => {
    const { isDslMode, ftsQuery } = useDslSearch(presetNames)
    expect(isDslMode.value).toBe(false)
    expect(ftsQuery.value).toBe('')
  })

  it('detects DSL mode when colons are present', async () => {
    const { rawInput, isDslMode } = useDslSearch(presetNames)
    rawInput.value = 'gnomad_af:<:0.01'
    await nextTick()
    expect(isDslMode.value).toBe(true)
  })

  it('stays in FTS mode for plain text', async () => {
    const { rawInput, isDslMode, ftsQuery } = useDslSearch(presetNames)
    rawInput.value = 'BRCA1 pathogenic'
    await nextTick()
    expect(isDslMode.value).toBe(false)
    expect(ftsQuery.value).toBe('BRCA1 pathogenic')
  })

  it('provides autocomplete suggestions for partial column', async () => {
    const { rawInput, suggestions } = useDslSearch(presetNames)
    rawInput.value = 'gno'
    await nextTick()
    expect(suggestions.value.some((s) => s.value === 'gnomad_af')).toBe(true)
  })

  it('provides operator suggestions after column:', async () => {
    const { rawInput, suggestions } = useDslSearch(presetNames)
    rawInput.value = 'gnomad_af:'
    await nextTick()
    expect(suggestions.value.some((s) => s.category === 'operator')).toBe(true)
  })

  it('provides preset suggestions for @ input', async () => {
    const { rawInput, suggestions } = useDslSearch(presetNames)
    rawInput.value = '@'
    await nextTick()
    expect(suggestions.value.some((s) => s.value === '@rare_pathogenic')).toBe(true)
  })

  it('clear resets all state', async () => {
    const { rawInput, clear, isDslMode } = useDslSearch(presetNames)
    rawInput.value = 'gnomad_af:<:0.01'
    await nextTick()
    expect(isDslMode.value).toBe(true)
    clear()
    expect(rawInput.value).toBe('')
    expect(isDslMode.value).toBe(false)
  })

  it('applySuggestion appends colon for column selection', () => {
    const { rawInput, applySuggestion } = useDslSearch(presetNames)
    rawInput.value = 'gno'
    applySuggestion({ value: 'gnomad_af', label: 'gnomad_af', category: 'column' })
    expect(rawInput.value).toBe('gnomad_af:')
  })

  it('applySuggestion appends colon for operator selection', () => {
    const { rawInput, applySuggestion } = useDslSearch(presetNames)
    rawInput.value = 'gnomad_af:'
    applySuggestion({ value: '<', label: '<', category: 'operator' })
    expect(rawInput.value).toBe('gnomad_af:<:')
  })

  it('applySuggestion appends space for value selection', () => {
    const { rawInput, applySuggestion } = useDslSearch(presetNames)
    rawInput.value = 'gnomad_af:<:'
    applySuggestion({ value: '0.01', label: '0.01', category: 'value' })
    expect(rawInput.value).toBe('gnomad_af:<:0.01 ')
  })
})
