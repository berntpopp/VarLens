/**
 * Unit tests for useGeneValidation composable
 *
 * Tests gene symbol parsing, validation, autocomplete, and result manipulation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useGeneValidation } from '@renderer/composables/useGeneValidation'
import type { ValidationResult, AutocompleteResult } from '@renderer/composables/useGeneValidation'
import { logService } from '../../../src/renderer/src/services/LogService'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    critical: vi.fn()
  }
}))

describe('useGeneValidation', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    window.api = createMockApi()
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  it('initializes with empty state', () => {
    const [result, appInstance] = withSetup(() => useGeneValidation())
    app = appInstance

    expect(result.validationResults.value).toEqual([])
    expect(result.suggestions.value).toEqual([])
    expect(result.validating.value).toBe(false)
    expect(result.loadingSuggestions.value).toBe(false)
    expect(result.approvedCount.value).toBe(0)
    expect(result.canSave.value).toBe(false)
  })

  // -------------------------------------------------------------------------
  // parseGeneText
  // -------------------------------------------------------------------------

  describe('parseGeneText', () => {
    it('splits on newlines', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      expect(result.parseGeneText('BRCA1\nBRCA2\nTP53')).toEqual(['BRCA1', 'BRCA2', 'TP53'])
    })

    it('splits on commas', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      expect(result.parseGeneText('BRCA1,BRCA2,TP53')).toEqual(['BRCA1', 'BRCA2', 'TP53'])
    })

    it('splits on semicolons', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      expect(result.parseGeneText('BRCA1;BRCA2;TP53')).toEqual(['BRCA1', 'BRCA2', 'TP53'])
    })

    it('splits on tabs', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      expect(result.parseGeneText('BRCA1\tBRCA2\tTP53')).toEqual(['BRCA1', 'BRCA2', 'TP53'])
    })

    it('handles mixed separators', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      expect(result.parseGeneText('BRCA1, BRCA2\nTP53; EGFR')).toEqual([
        'BRCA1',
        'BRCA2',
        'TP53',
        'EGFR'
      ])
    })

    it('trims whitespace and uppercases', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      expect(result.parseGeneText('  brca1 , brca2  ')).toEqual(['BRCA1', 'BRCA2'])
    })

    it('filters empty strings', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      expect(result.parseGeneText('BRCA1,,,,BRCA2')).toEqual(['BRCA1', 'BRCA2'])
    })

    it('deduplicates symbols', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      expect(result.parseGeneText('BRCA1,BRCA2,BRCA1')).toEqual(['BRCA1', 'BRCA2'])
    })

    it('returns empty array for empty input', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      expect(result.parseGeneText('')).toEqual([])
      expect(result.parseGeneText('   ')).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // validateSymbols
  // -------------------------------------------------------------------------

  describe('validateSymbols', () => {
    it('validates symbols with mixed results', async () => {
      const mockResults: ValidationResult[] = [
        { input: 'BRCA1', status: 'approved', symbol: 'BRCA1', hgncId: 'HGNC:1100' },
        {
          input: 'FANCD1',
          status: 'alias',
          symbol: 'FANCD1',
          hgncId: 'HGNC:1101',
          currentSymbol: 'BRCA2',
          aliasType: 'alias_symbol'
        },
        {
          input: 'ABC',
          status: 'ambiguous',
          candidates: [
            { symbol: 'ABCA1', hgncId: 'HGNC:29' },
            { symbol: 'ABCB1', hgncId: 'HGNC:40' }
          ]
        },
        { input: 'FAKEGENE', status: 'unknown' }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockResolvedValue(mockResults)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      const returned = await result.validateSymbols(['BRCA1', 'FANCD1', 'ABC', 'FAKEGENE'])

      expect(returned).toEqual(mockResults)
      expect(result.validationResults.value).toEqual(mockResults)
      expect(result.approvedCount.value).toBe(1)
      expect(result.aliasCount.value).toBe(1)
      expect(result.ambiguousCount.value).toBe(1)
      expect(result.unknownCount.value).toBe(1)
      expect(result.canSave.value).toBe(false)
    })

    it('sets validating flag during validation', async () => {
      let resolveValidation: (value: ValidationResult[]) => void
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockImplementation(
        () =>
          new Promise<ValidationResult[]>((resolve) => {
            resolveValidation = resolve
          })
      )

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      const promise = result.validateSymbols(['BRCA1'])
      expect(result.validating.value).toBe(true)

      resolveValidation!([
        { input: 'BRCA1', status: 'approved', symbol: 'BRCA1', hgncId: 'HGNC:1100' }
      ])
      await promise

      expect(result.validating.value).toBe(false)
    })

    it('returns empty array for empty input', async () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      const returned = await result.validateSymbols([])

      expect(returned).toEqual([])
      expect(result.validationResults.value).toEqual([])
    })

    it('handles validation error gracefully', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockRejectedValue(new Error('DB error'))

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      const returned = await result.validateSymbols(['BRCA1'])

      expect(returned).toEqual([])
      expect(result.validationResults.value).toEqual([])
      expect(result.validating.value).toBe(false)
      expect(logService.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to validate gene symbols:'),
        'gene-validation'
      )
    })
  })

  // -------------------------------------------------------------------------
  // autocomplete
  // -------------------------------------------------------------------------

  describe('autocomplete', () => {
    it('fetches autocomplete results', async () => {
      const mockSuggestions: AutocompleteResult[] = [
        {
          symbol: 'BRCA1',
          hgncId: 'HGNC:1100',
          name: 'BRCA1 DNA repair',
          locusGroup: 'protein-coding gene',
          matchType: 'symbol'
        },
        {
          symbol: 'BRCA2',
          hgncId: 'HGNC:1101',
          name: 'BRCA2 DNA repair',
          locusGroup: 'protein-coding gene',
          matchType: 'symbol'
        }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.autocomplete.mockResolvedValue(mockSuggestions)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.autocomplete('BRC')

      expect(result.suggestions.value).toEqual(mockSuggestions)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window.api as any).panels.autocomplete).toHaveBeenCalledWith('BRC', undefined)
    })

    it('passes limit parameter', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.autocomplete.mockResolvedValue([])

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.autocomplete('BRC', 5)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window.api as any).panels.autocomplete).toHaveBeenCalledWith('BRC', 5)
    })

    it('skips short queries', async () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.autocomplete('B')

      expect(result.suggestions.value).toEqual([])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window.api as any).panels.autocomplete).not.toHaveBeenCalled()
    })

    it('clears suggestions on empty query', async () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      // Set some suggestions first
      result.suggestions.value = [
        {
          symbol: 'BRCA1',
          hgncId: 'HGNC:1100',
          name: 'test',
          locusGroup: 'test',
          matchType: 'symbol'
        }
      ]

      await result.autocomplete('')

      expect(result.suggestions.value).toEqual([])
    })

    it('handles autocomplete error gracefully', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.autocomplete.mockRejectedValue(new Error('Network error'))

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.autocomplete('BRC')

      expect(result.suggestions.value).toEqual([])
      expect(result.loadingSuggestions.value).toBe(false)
      expect(logService.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to autocomplete gene:'),
        'gene-validation'
      )
    })
  })

  // -------------------------------------------------------------------------
  // canSave
  // -------------------------------------------------------------------------

  describe('canSave', () => {
    it('is false when results are empty', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      expect(result.canSave.value).toBe(false)
    })

    it('is true when all results are approved', async () => {
      const mockResults: ValidationResult[] = [
        { input: 'BRCA1', status: 'approved', symbol: 'BRCA1', hgncId: 'HGNC:1100' },
        { input: 'TP53', status: 'approved', symbol: 'TP53', hgncId: 'HGNC:11998' }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockResolvedValue(mockResults)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.validateSymbols(['BRCA1', 'TP53'])

      expect(result.canSave.value).toBe(true)
    })

    it('is false when any result is not approved', async () => {
      const mockResults: ValidationResult[] = [
        { input: 'BRCA1', status: 'approved', symbol: 'BRCA1', hgncId: 'HGNC:1100' },
        { input: 'FAKEGENE', status: 'unknown' }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockResolvedValue(mockResults)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.validateSymbols(['BRCA1', 'FAKEGENE'])

      expect(result.canSave.value).toBe(false)
    })

    it('is false when aliases are present', async () => {
      const mockResults: ValidationResult[] = [
        { input: 'BRCA1', status: 'approved', symbol: 'BRCA1', hgncId: 'HGNC:1100' },
        { input: 'FANCD1', status: 'alias', currentSymbol: 'BRCA2', hgncId: 'HGNC:1101' }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockResolvedValue(mockResults)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.validateSymbols(['BRCA1', 'FANCD1'])

      expect(result.canSave.value).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // acceptAlias
  // -------------------------------------------------------------------------

  describe('acceptAlias', () => {
    it('changes alias to approved with current symbol', async () => {
      const mockResults: ValidationResult[] = [
        {
          input: 'FANCD1',
          status: 'alias',
          symbol: 'FANCD1',
          hgncId: 'HGNC:1101',
          currentSymbol: 'BRCA2',
          aliasType: 'alias_symbol'
        }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockResolvedValue(mockResults)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.validateSymbols(['FANCD1'])
      expect(result.aliasCount.value).toBe(1)
      expect(result.canSave.value).toBe(false)

      result.acceptAlias(0)

      expect(result.validationResults.value[0].status).toBe('approved')
      expect(result.validationResults.value[0].symbol).toBe('BRCA2')
      expect(result.approvedCount.value).toBe(1)
      expect(result.aliasCount.value).toBe(0)
      expect(result.canSave.value).toBe(true)
    })

    it('does nothing for non-alias result', async () => {
      const mockResults: ValidationResult[] = [
        { input: 'BRCA1', status: 'approved', symbol: 'BRCA1', hgncId: 'HGNC:1100' }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockResolvedValue(mockResults)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.validateSymbols(['BRCA1'])
      result.acceptAlias(0)

      // Unchanged
      expect(result.validationResults.value[0].status).toBe('approved')
      expect(result.validationResults.value[0].symbol).toBe('BRCA1')
    })

    it('does nothing for out-of-bounds index', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      // Should not throw
      result.acceptAlias(5)
      expect(result.validationResults.value).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // removeResult
  // -------------------------------------------------------------------------

  describe('removeResult', () => {
    it('removes result at given index', async () => {
      const mockResults: ValidationResult[] = [
        { input: 'BRCA1', status: 'approved', symbol: 'BRCA1', hgncId: 'HGNC:1100' },
        { input: 'FAKEGENE', status: 'unknown' },
        { input: 'TP53', status: 'approved', symbol: 'TP53', hgncId: 'HGNC:11998' }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockResolvedValue(mockResults)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.validateSymbols(['BRCA1', 'FAKEGENE', 'TP53'])
      expect(result.validationResults.value).toHaveLength(3)
      expect(result.canSave.value).toBe(false)

      result.removeResult(1) // Remove FAKEGENE

      expect(result.validationResults.value).toHaveLength(2)
      expect(result.validationResults.value[0].input).toBe('BRCA1')
      expect(result.validationResults.value[1].input).toBe('TP53')
      expect(result.canSave.value).toBe(true)
    })

    it('does nothing for out-of-bounds index', () => {
      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      result.removeResult(-1)
      result.removeResult(10)
      expect(result.validationResults.value).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // resolveAmbiguous
  // -------------------------------------------------------------------------

  describe('resolveAmbiguous', () => {
    it('resolves ambiguous result with chosen candidate', async () => {
      const mockResults: ValidationResult[] = [
        {
          input: 'ABC',
          status: 'ambiguous',
          candidates: [
            { symbol: 'ABCA1', hgncId: 'HGNC:29' },
            { symbol: 'ABCB1', hgncId: 'HGNC:40' }
          ]
        }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockResolvedValue(mockResults)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.validateSymbols(['ABC'])
      expect(result.ambiguousCount.value).toBe(1)

      result.resolveAmbiguous(0, { symbol: 'ABCA1', hgncId: 'HGNC:29' })

      expect(result.validationResults.value[0].status).toBe('approved')
      expect(result.validationResults.value[0].symbol).toBe('ABCA1')
      expect(result.validationResults.value[0].hgncId).toBe('HGNC:29')
      expect(result.ambiguousCount.value).toBe(0)
      expect(result.approvedCount.value).toBe(1)
    })

    it('does nothing for non-ambiguous result', async () => {
      const mockResults: ValidationResult[] = [
        { input: 'BRCA1', status: 'approved', symbol: 'BRCA1', hgncId: 'HGNC:1100' }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockResolvedValue(mockResults)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.validateSymbols(['BRCA1'])
      result.resolveAmbiguous(0, { symbol: 'OTHER', hgncId: 'HGNC:999' })

      // Unchanged
      expect(result.validationResults.value[0].symbol).toBe('BRCA1')
    })
  })

  // -------------------------------------------------------------------------
  // approvedGenes
  // -------------------------------------------------------------------------

  describe('approvedGenes', () => {
    it('returns only approved genes with hgncId and symbol', async () => {
      const mockResults: ValidationResult[] = [
        { input: 'BRCA1', status: 'approved', symbol: 'BRCA1', hgncId: 'HGNC:1100' },
        { input: 'FAKEGENE', status: 'unknown' },
        { input: 'TP53', status: 'approved', symbol: 'TP53', hgncId: 'HGNC:11998' }
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window.api as any).panels.validateSymbols.mockResolvedValue(mockResults)

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      await result.validateSymbols(['BRCA1', 'FAKEGENE', 'TP53'])

      expect(result.approvedGenes.value).toEqual([
        { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
        { hgncId: 'HGNC:11998', symbol: 'TP53' }
      ])
    })
  })

  // -------------------------------------------------------------------------
  // API unavailable
  // -------------------------------------------------------------------------

  describe('API unavailable', () => {
    it('handles missing API gracefully', async () => {
      // @ts-expect-error - Testing undefined case
      delete window.api

      const [result, appInstance] = withSetup(() => useGeneValidation())
      app = appInstance

      const validated = await result.validateSymbols(['BRCA1'])
      expect(validated).toEqual([])

      await result.autocomplete('BRC')
      expect(result.suggestions.value).toEqual([])
    })
  })
})
