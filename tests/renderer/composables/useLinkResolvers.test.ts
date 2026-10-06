import { describe, expect, it } from 'vitest'
import {
  buildLinkOutDefs,
  buildLinkResolvers,
  resolveRowLinks
} from '../../../src/renderer/src/composables/useLinkResolvers'
import type { ExternalLinkConfig } from '../../../src/renderer/src/stores/externalLinksStore'

const link = (over: Partial<ExternalLinkConfig>): ExternalLinkConfig => ({
  id: 'x',
  name: 'X',
  urlTemplate: 'https://x.test/{chr}-{pos}',
  column: 'virtual',
  requiredFields: ['chr', 'pos'],
  enabled: true,
  isBuiltIn: false,
  ...over
})

const row = { chr: '7', pos: 117559590, ref: 'A', alt: 'G', gene_symbol: 'CFTR' }

describe('shared link resolvers (case / cohort / shortlist)', () => {
  it('resolves column links under the column key and link-outs under _link_<id>', () => {
    const resolvers = buildLinkResolvers(
      [
        link({ id: 'ucsc', column: 'chr' }),
        link({
          id: 'mylab',
          name: 'My Lab',
          urlTemplate: 'https://lab.test/{gene}',
          requiredFields: ['gene']
        })
      ],
      'GRCh38'
    )
    expect(resolveRowLinks(row, resolvers)).toEqual({
      chr: 'https://x.test/7-117559590',
      _link_mylab: 'https://lab.test/CFTR'
    })
  })

  it('yields null when a required field is missing', () => {
    const resolvers = buildLinkResolvers([link({ requiredFields: ['gene'] })], 'GRCh38')
    expect(resolveRowLinks({ ...row, gene_symbol: null }, resolvers)._link_x).toBeNull()
  })

  it('lists only virtual links for the Links column, custom links included', () => {
    const defs = buildLinkOutDefs([
      link({ id: 'ucsc', column: 'chr' }),
      link({ id: 'varsome', name: 'VarSome' }),
      link({ id: 'c1', name: 'My Lab DB' })
    ])
    expect(defs).toEqual([
      { key: '_link_varsome', name: 'VarSome', abbreviation: 'VS' },
      { key: '_link_c1', name: 'My Lab DB', abbreviation: 'ML' }
    ])
  })
})
