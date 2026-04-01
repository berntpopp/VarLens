import { describe, it, expect } from 'vitest'
import { buildRowViewModels } from '../../../../src/renderer/src/components/variant-table/useVariantRowViewModel'
import type { Variant } from '../../../../src/main/database/types'

describe('buildRowViewModels', () => {
  const makeVariant = (chr: string, pos: number, ref: string, alt: string): Variant =>
    ({ chr, pos, ref, alt, gene_symbol: 'BRCA1', clinvar: 'Pathogenic' }) as unknown as Variant

  it('should precompute annotation flags from cache', () => {
    const variants = [makeVariant('1', 100, 'A', 'T')]
    const annotationCache = new Map([
      [
        '1:100:A:T',
        {
          perCase: { starred: 1, acmg_classification: 'LP' as const, comment: 'test' },
          global: { starred: 0, acmg_classification: 'VUS' as const, comment: '' }
        }
      ]
    ])

    const result = buildRowViewModels(variants, annotationCache, {})

    const vm = result.get('1:100:A:T')
    expect(vm).toBeDefined()
    expect(vm!.isStarred).toBe(true)
    expect(vm!.isGlobalStarred).toBe(false)
    expect(vm!.acmgClassification).toBe('LP')
    expect(vm!.globalAcmgClassification).toBe('VUS')
    expect(vm!.hasComment).toBe(true)
    expect(vm!.hasGlobalComment).toBe(false)
  })

  it('should handle missing annotations gracefully', () => {
    const variants = [makeVariant('1', 200, 'G', 'C')]
    const result = buildRowViewModels(variants, new Map(), {})

    const vm = result.get('1:200:G:C')
    expect(vm).toBeDefined()
    expect(vm!.isStarred).toBe(false)
    expect(vm!.acmgClassification).toBeNull()
    expect(vm!.hasComment).toBe(false)
  })

  it('should precompute link URLs from link config', () => {
    const variants = [makeVariant('1', 100, 'A', 'T')]
    const linkConfig = {
      chr: { id: 'ucsc', resolve: (item: Variant) => `https://ucsc.edu/${item.chr}:${item.pos}` },
      gene_symbol: {
        id: 'omim',
        resolve: (item: Variant) =>
          item.gene_symbol ? `https://omim.org/${item.gene_symbol}` : null
      }
    }

    const result = buildRowViewModels(variants, new Map(), linkConfig)

    const vm = result.get('1:100:A:T')
    expect(vm!.links.chr).toBe('https://ucsc.edu/1:100')
    expect(vm!.links.gene_symbol).toBe('https://omim.org/BRCA1')
  })
})
