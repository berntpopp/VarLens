import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import VcfPreviewStep from '../../../../src/renderer/src/components/import/VcfPreviewStep.vue'
import { CASE_NAME_MESSAGES } from '../../../../src/renderer/src/config/importConfig'
import { createMockApi } from '../../../utils/mock-api'

const vuetify = createVuetify({ components, directives })

async function mountStep(samples: string[], existing: string[]) {
  const api = createMockApi()
  api.import.vcfPreview = vi.fn().mockResolvedValue({
    fileformat: 'VCFv4.2',
    annotationType: 'csq',
    variantCountEstimate: 10,
    samples,
    detectedGenomeBuild: 'GRCh38',
    infoFields: []
  })
  api.cases.list = vi.fn().mockResolvedValue(existing.map((name, id) => ({ id, name })))
  window.api = api as unknown as typeof window.api
  const wrapper = mount(VcfPreviewStep, {
    props: { filePath: '/x.vcf' },
    global: { plugins: [vuetify] }
  })
  await flushPromises()
  return wrapper
}

const lastValid = (wrapper: Awaited<ReturnType<typeof mountStep>>) =>
  (wrapper.emitted('selection-changed')!.at(-1)![0] as { valid: boolean }).valid

describe('VcfPreviewStep case names', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('accepts new, distinct names', async () => {
    const wrapper = await mountStep(['S1', 'S2'], ['OTHER'])
    expect(lastValid(wrapper)).toBe(true)
    expect(wrapper.text()).not.toContain(CASE_NAME_MESSAGES.REQUIRED)
  })

  it('flags a name that already exists in the database', async () => {
    const wrapper = await mountStep(['HG005'], ['HG005'])
    expect(lastValid(wrapper)).toBe(false)
    expect(wrapper.text()).toContain(CASE_NAME_MESSAGES.EXISTS('HG005'))
  })

  it('flags a cleared name instead of silently showing the sample ID', async () => {
    const wrapper = await mountStep(['S1'], [])
    await wrapper.find('[data-testid="vcf-case-name-S1"] input').setValue('  ')
    expect(lastValid(wrapper)).toBe(false)
    expect(wrapper.text()).toContain(CASE_NAME_MESSAGES.REQUIRED)
  })

  it('flags the same name used for two samples of this file', async () => {
    const wrapper = await mountStep(['S1', 'S2'], [])
    await wrapper.find('[data-testid="vcf-case-name-S2"] input').setValue('S1')
    expect(lastValid(wrapper)).toBe(false)
    expect(wrapper.text()).toContain(CASE_NAME_MESSAGES.REPEATED)
  })
})
