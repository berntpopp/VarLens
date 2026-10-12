import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import BatchReviewPhase from '../../../../src/renderer/src/components/batch-import/BatchReviewPhase.vue'
import { BUILD_COPY } from '../../../../src/shared/config/genome-builds.config'

const vuetify = createVuetify({ components, directives })

const file = (fileName: string, build?: { suggested: string | null; confidence: string }) => ({
  caseName: fileName.split('.')[0],
  fileName,
  isDuplicate: false,
  build
})

function mountPhase(reviewFiles: ReturnType<typeof file>[]) {
  return mount(BatchReviewPhase, {
    props: {
      reviewFiles: reviewFiles as never,
      fileCount: reviewFiles.length,
      duplicateCount: 0,
      duplicateStrategy: 'skip',
      stripText: '',
      hasEmptyCaseNames: false,
      fallbackBuild: null
    },
    global: { plugins: [vuetify] }
  })
}

describe('BatchReviewPhase genome builds', () => {
  it('tallies the builds per file and asks for the build of files without one', () => {
    const wrapper = mountPhase([
      file('a.vcf.gz', { suggested: 'GRCh38', confidence: 'definitive' }),
      file('b.vcf.gz', { suggested: 'GRCh37', confidence: 'definitive' }),
      file('c.vcf.gz', { suggested: 'GRCh37', confidence: 'strong' }),
      file('d.json', { suggested: null, confidence: 'none' }),
      file('e.vcf', { suggested: null, confidence: 'conflict' })
    ])
    expect(wrapper.get('[data-testid="batch-build-tally"]').text()).toBe(
      '1 GRCh38 · 1 GRCh37 · 1 from header tags only · 1 without a build'
    )
    expect(wrapper.get('[data-testid="batch-build-skipped"]').text()).toBe(
      `e.vcf: ${BUILD_COPY.skippedConflict}`
    )
    expect(wrapper.text()).toContain(BUILD_COPY.fallbackLabel)
    expect((wrapper.vm as unknown as { validate: () => boolean }).validate()).toBe(false)
  })

  it('needs no fallback when every file decides its own build', () => {
    const wrapper = mountPhase([
      file('a.vcf.gz', { suggested: 'GRCh38', confidence: 'definitive' })
    ])
    expect(wrapper.text()).not.toContain(BUILD_COPY.fallbackLabel)
    expect((wrapper.vm as unknown as { validate: () => boolean }).validate()).toBe(true)
  })
})
