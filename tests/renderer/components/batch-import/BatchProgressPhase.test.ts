import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import BatchProgressPhase from '../../../../src/renderer/src/components/batch-import/BatchProgressPhase.vue'

const vuetify = createVuetify({ components, directives })

const base = {
  currentFileName: 'HG002.vcf.gz',
  currentIndex: 1,
  totalFiles: 8,
  overallPercent: 25,
  variantCount: 1200
}

function mountPhase(extra: Record<string, unknown> = {}) {
  return mount(BatchProgressPhase, { props: { ...base, ...extra }, global: { plugins: [vuetify] } })
}

describe('BatchProgressPhase', () => {
  it('lists the files importing now with a readable phase and variant count', () => {
    const wrapper = mountPhase({
      completedFiles: 2,
      inFlight: [
        { index: 2, fileName: 'HG003.vcf.gz', phase: 'parsing', count: 0 },
        { index: 3, fileName: 'HG004.vcf.gz', phase: 'inserting', count: 45000 }
      ]
    })

    expect(wrapper.get('[data-testid="batch-progress-headline"]').text()).toBe('2 of 8 files done')
    const rows = wrapper.findAll('[data-testid="batch-in-flight-file"]').map((row) => row.text())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('HG003.vcf.gz')
    expect(rows[0]).toContain('Parsing variants')
    expect(rows[0]).not.toContain('variants ·')
    expect(rows[1]).toContain('Importing variants')
    expect(rows[1]).toContain(`${(45000).toLocaleString()} variants`)
    expect(wrapper.text()).not.toContain('Variants processed')
  })

  it('falls back to the single-file display when the backend reports no parallel detail', () => {
    const wrapper = mountPhase()

    expect(wrapper.get('[data-testid="batch-progress-headline"]').text()).toBe(
      'Importing HG002.vcf.gz (2 of 8)'
    )
    expect(wrapper.findAll('[data-testid="batch-in-flight-file"]')).toHaveLength(0)
    expect(wrapper.text()).toContain(`Variants processed: ${(1200).toLocaleString()}`)
  })
})
