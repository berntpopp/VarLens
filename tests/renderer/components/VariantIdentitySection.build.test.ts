/** Coordinates and HGVS are shown and copied with their genome build (#576). */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import VariantIdentitySection from '../../../src/renderer/src/components/VariantIdentitySection.vue'
import { installCapabilities } from '../helpers/capabilities'

const vuetify = createVuetify({ components, directives })
const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  installCapabilities()
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

const variant = {
  chr: 'chr22',
  pos: 29539391,
  ref: 'T',
  alt: 'C',
  gene_symbol: 'THOC5',
  transcript: null,
  cdna: 'ENST00000490103.6:c.538A>G',
  aa_change: 'ENSP00000419425.1:p.Met180Val'
}

function render(genomeBuild: string | null) {
  return mount(VariantIdentitySection, {
    props: { variant: variant as never, genomeBuild },
    global: { plugins: [vuetify] }
  })
}

const copyButton = (w: ReturnType<typeof render>, label: RegExp) =>
  w.findAll('button').find((b) => label.test(b.attributes('aria-label') ?? ''))!

describe('VariantIdentitySection genome build', () => {
  it('shows the build next to the coordinate', () => {
    expect(render('GRCh38').find('[data-testid="genome-build"]').text()).toBe('GRCh38')
  })

  it('copies the coordinate and the HGVS with the build', async () => {
    const w = render('GRCh38')
    await copyButton(w, /chr:pos:ref:alt/).trigger('click')
    await copyButton(w, /HGVS/).trigger('click')
    expect(writeText.mock.calls.map(([t]) => t)).toEqual([
      'GRCh38 chr22:29539391:T:C',
      'GRCh38 ENST00000490103.6:c.538A>G ENSP00000419425.1:p.Met180Val'
    ])
  })

  it('copies without a build while it is unknown', async () => {
    const w = render(null)
    expect(w.find('[data-testid="genome-build"]').exists()).toBe(false)
    await copyButton(w, /chr:pos:ref:alt/).trigger('click')
    expect(writeText).toHaveBeenCalledWith('chr22:29539391:T:C')
  })
})
