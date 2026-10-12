/** The plot tooltip says everything the old one did, and lists co-located variants. */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import TrackTooltip from '../../../../../src/renderer/src/components/protein/track/TrackTooltip.vue'
import type { TrackMarker } from '../../../../../src/renderer/src/utils/track-window'

const base: TrackMarker = {
  key: 'a',
  position: 180,
  track: 'variant',
  label: 'p.Met180Val',
  weight: 1,
  color: '#000'
}

const text = (data: object, unit: 'aa' | 'bp' = 'aa') =>
  mount(TrackTooltip, {
    props: { data: { visible: true, x: 0, y: 0, ...data }, unit },
    global: { stubs: { teleport: true } }
  }).text()

describe('TrackTooltip', () => {
  it('a case variant: consequence, CADD and gnomAD AF', () => {
    const t = text({ marker: { ...base, consequence: 'missense_variant', cadd: 24.5, af: 0.0012 } })
    expect(t).toContain('Missense')
    expect(t).toContain('24.5')
    expect(t).toContain('1.20e-3')
  })

  it('a cohort variant names its carriers', () => {
    expect(text({ marker: { ...base, track: 'cohort', carriers: 3 } })).toContain(
      'p.Met180Val · 3 carriers'
    )
  })

  it('a ClinVar record: class, stars and variation ID', () => {
    const t = text({
      marker: {
        ...base,
        track: 'clinvar',
        clinvarClass: 'pathogenic',
        stars: 2,
        clinvarId: '12345'
      }
    })
    expect(t).toContain('Pathogenic ★★')
    expect(t).toContain('12345')
  })

  it('a gnomAD variant: AF and AC / AN', () => {
    expect(text({ marker: { ...base, track: 'gnomad', af: 0.001, ac: 3, an: 3000 } })).toContain(
      '3 / 3,000'
    )
  })

  it('a domain: type and accession', () => {
    const t = text({
      feature: { key: 'd', name: 'THO', start: 1, end: 90, type: 'domain', accession: 'IPR1' }
    })
    expect(t).toContain('domain')
    expect(t).toContain('IPR1')
  })

  it('variants at one position are listed (up to five)', () => {
    const members = Array.from({ length: 7 }, (_, i) => ({
      ...base,
      key: `m${i}`,
      label: `p.Met180V${i}`
    }))
    const t = text({
      marker: { ...base, label: 'p.Met180Val +6', members, binnedKeys: members.map((m) => m.key) }
    })
    expect(t).toContain('p.Met180V0')
    expect(t).toContain('p.Met180V4')
    expect(t).not.toContain('p.Met180V5')
    expect(t).toContain('+2 more')
  })
})
