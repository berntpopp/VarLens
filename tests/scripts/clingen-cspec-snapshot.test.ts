/** ClinGen CSpec snapshot (#201): the refresh transform and the bundled file. */
import { describe, expect, it } from 'vitest'

import { toSnapshot } from '../../scripts/clingen/refresh-cspec-snapshot.mjs'
import snapshot from '../../src/renderer/src/assets/data/clingen-cspec.json'
import { isUrlSafeForExternal } from '../../src/shared/utils/url-validation'

const svi = (
  id: string,
  status: string,
  genes: string[],
  url = `https://cspec.genome.network/cspec/ui/svi/doc/${id}`
) => ({
  '@id': `https://cspec.genome.network/cspec/api/SequenceVariantInterpretation/id/${id}`,
  status,
  version: '1.0',
  url,
  affiliation: { label: `${id} Panel ` },
  ruleSets: [{ genes: genes.map((label) => ({ label })) }]
})

describe('toSnapshot', () => {
  it('keeps released specs on the registry, per gene, sorted and de-duplicated', () => {
    const out = toSnapshot(
      {
        data: [
          svi('GN150', 'Released', ['RYR1']),
          svi('GN012', 'Released', ['RYR1', 'RYR1']),
          svi('GN999', 'Pilot Rules In Prep', ['TP53']),
          svi('GN998', 'Released', ['EVIL'], 'https://evil.example/doc')
        ]
      },
      '2026-10-13'
    )
    expect(out.retrieved).toBe('2026-10-13')
    expect(Object.keys(out.genes)).toEqual(['RYR1'])
    expect(out.genes.RYR1.map((s: { id: string }) => s.id)).toEqual(['GN012', 'GN150'])
    expect(out.genes.RYR1[0].panel).toBe('GN012 Panel')
  })

  it('rejects a response without data', () => {
    expect(() => toSnapshot({}, '2026-10-13')).toThrow(/no data/)
  })
})

describe('bundled snapshot', () => {
  it('is dated and every spec link may be opened externally', () => {
    expect(snapshot.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const specs = Object.values(snapshot.genes).flat()
    expect(specs.length).toBeGreaterThan(100)
    for (const spec of specs)
      expect(isUrlSafeForExternal(spec.url, { includeUserDomains: false })).toBe(true)
  })
})
