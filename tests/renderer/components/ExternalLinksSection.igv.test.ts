/**
 * The "Local IGV" action (#93): sends the call's interval (or its position),
 * names the genome IGV must show, and makes an unanswered port visible and
 * retryable instead of only logging it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ExternalLinksSection from '../../../src/renderer/src/components/ExternalLinksSection.vue'
import { IGV_COPY } from '../../../src/renderer/src/config/uiCopyConfig'
import { igvGenomeId, igvLocus } from '../../../src/renderer/src/utils/igv-desktop'
import { installCapabilities } from '../helpers/capabilities'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const vuetify = createVuetify({ components, directives })

const snv = { chr: 'chr1', pos: 100, ref: 'A', alt: 'T', gene_symbol: null, variant_type: 'snv' }
const deletion = {
  ...snv,
  chr: 'chr7',
  pos: 1000,
  ref: 'N',
  alt: '<DEL>',
  variant_type: 'cnv',
  sv_type: 'DEL',
  end_pos: 5000
}

describe('igvLocus / igvGenomeId', () => {
  it('sends the interval of an SV/CNV call and the position otherwise', () => {
    expect(igvLocus(snv)).toBe('chr1:100-100')
    expect(igvLocus(deletion)).toBe('chr7:1000-5000')
    expect(igvLocus({ ...deletion, variant_type: 'sv', sv_type: 'BND', end_pos: 9000 })).toBe(
      'chr7:1000-1000'
    )
  })

  it('maps known builds to IGV genome ids and keeps unknown ones unknown', () => {
    expect(igvGenomeId('GRCh38')).toBe('hg38')
    expect(igvGenomeId('hg19')).toBe('hg19')
    expect(igvGenomeId(null)).toBeNull()
    expect(igvGenomeId('CHM13')).toBeNull()
  })
})

describe('ExternalLinksSection Local IGV', () => {
  const fetchMock = vi.fn()
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    installCapabilities({ runtime: 'desktop', role: 'user' })
    vi.stubGlobal('fetch', fetchMock.mockReset().mockResolvedValue({}))
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
  })

  async function jump(variant: object, genomeBuild: string | null): Promise<VueWrapper> {
    wrapper = mount(ExternalLinksSection, {
      props: { variant: variant as never, genomeBuild },
      global: { plugins: [vuetify] }
    })
    await wrapper.find('[aria-label="Broadcast locus to local IGV"]').trigger('click')
    await flushPromises()
    return wrapper
  }

  const sentUrl = (): string => String(fetchMock.mock.calls.at(-1)?.[0])

  it('jumps to a point variant and names the genome IGV must show', async () => {
    const w = await jump(snv, 'GRCh38')
    expect(sentUrl()).toBe('http://localhost:60151/goto?locus=chr1%3A100-100')
    expect(w.find('[data-testid="igv-sent"]').text()).toBe(
      `${IGV_COPY.sent('chr1:100-100')} ${IGV_COPY.genome('hg38')}`
    )
  })

  it('jumps to the whole interval of a deletion', async () => {
    await jump(deletion, 'GRCh37')
    expect(sentUrl()).toBe('http://localhost:60151/goto?locus=chr7%3A1000-5000')
    expect(wrapper!.text()).toContain(IGV_COPY.genome('hg19'))
  })

  it('says so when the build is unknown', async () => {
    const w = await jump(deletion, null)
    expect(w.find('[data-testid="igv-sent"]').text()).toContain(IGV_COPY.unknownBuild)
  })

  it('shows an unanswered port as a failure and retries it', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const w = await jump(snv, 'GRCh38')
    expect(w.find('[data-testid="igv-failed"]').text()).toContain(IGV_COPY.unreachable)
    expect(w.find('[data-testid="igv-sent"]').exists()).toBe(false)

    await w.find('[data-testid="igv-retry"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(w.find('[data-testid="igv-failed"]').exists()).toBe(false)
    expect(w.find('[data-testid="igv-sent"]').exists()).toBe(true)
  })
})
