import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import VcfFileList from '@renderer/components/import/VcfFileList.vue'
import type { VcfPreviewResult } from '../../../../src/shared/types/import'

const vuetify = createVuetify()

function makePreview(filePath: string): VcfPreviewResult {
  return {
    fileformat: 'VCFv4.2',
    samples: ['SAMPLE1'],
    variantCountEstimate: 42,
    annotationType: 'csq',
    detectedGenomeBuild: 'GRCh38',
    buildDetection: { suggested: 'GRCh38', confidence: 'definitive', reason: 'header' },
    infoFields: [],
    callerName: 'DeepVariant',
    callerVersion: '1.6.0',
    defaultVariantType: 'snv',
    annotationFields: [],
    filePath,
    fileSize: 1024
  }
}

describe('VcfFileList (#636)', () => {
  it('shows the directory subtitle and full path title for local filesystem paths', () => {
    const wrapper = mount(VcfFileList, {
      props: {
        files: [makePreview('/data/sample.vcf.gz')],
        overrides: new Map()
      },
      global: { plugins: [vuetify] }
    })

    expect(wrapper.text()).toContain('sample.vcf.gz')
    expect(wrapper.text()).toContain('/data')
    const nameEl = wrapper.find('[title="/data/sample.vcf.gz"]')
    expect(nameEl.exists()).toBe(true)
  })

  it('hides the internal staged upload handle in subtitle and title', () => {
    const stagedRef = 'web-upload:1e94da05-0000-4000-8000-000000000001/sample.vcf.gz'
    const wrapper = mount(VcfFileList, {
      props: {
        files: [makePreview(stagedRef)],
        overrides: new Map()
      },
      global: { plugins: [vuetify] }
    })

    expect(wrapper.text()).toContain('sample.vcf.gz')
    expect(wrapper.text()).not.toContain('web-upload:')
    expect(wrapper.html()).not.toContain('web-upload:')
    const nameEl = wrapper.find('[title="sample.vcf.gz"]')
    expect(nameEl.exists()).toBe(true)
  })
})
