import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import GenomeBuildField from '../../../../src/renderer/src/components/import/GenomeBuildField.vue'
import {
  BUILD_COPY,
  GENOME_BUILDS,
  IMPORTABLE_GENOME_BUILDS
} from '../../../../src/shared/config/genome-builds.config'
import {
  combineBuildDetections,
  describeBuildDetection,
  detectGenomeBuild,
  type BuildDetection
} from '../../../../src/shared/genome/genome-build'

const vuetify = createVuetify({ components, directives })
const contig = (build: string): string =>
  `##contig=<ID=1,length=${GENOME_BUILDS.find((b) => b.id === build)!.contigs[1]}>`

const STATES: Record<string, BuildDetection> = {
  definitive: detectGenomeBuild([contig('GRCh37')]),
  strong: detectGenomeBuild(['##reference=hg19.fa']),
  conflict: detectGenomeBuild([contig('GRCh38'), '##reference=hg19.fa']),
  none: detectGenomeBuild([])
}

function mountField(detection: BuildDetection, modelValue: string | null = null) {
  return mount(GenomeBuildField, {
    props: { detection, modelValue },
    global: { plugins: [vuetify] }
  })
}

describe('GenomeBuildField', () => {
  it('offers only the importable builds from the config', () => {
    const wrapper = mountField(STATES.none)
    const labels = wrapper.findAll('.v-radio').map((r) => r.text())
    expect(labels).toHaveLength(IMPORTABLE_GENOME_BUILDS.length)
    for (const build of IMPORTABLE_GENOME_BUILDS) {
      expect(labels.some((l) => l.startsWith(build.label))).toBe(true)
    }
  })

  it.each(Object.entries(STATES))('renders the %s copy and never says "Auto-detected"', (_s, d) => {
    const text = mountField(d).text()
    expect(text).toContain(describeBuildDetection(d))
    expect(text).not.toMatch(/auto-detected/i)
  })

  it('pre-selects only a definitive result', async () => {
    for (const [state, detection] of Object.entries(STATES)) {
      const wrapper = mountField(detection)
      await wrapper.vm.$nextTick()
      const emitted = wrapper.emitted('update:modelValue')
      if (state === 'definitive') expect(emitted).toEqual([['GRCh37']])
      else expect(emitted, state).toBeUndefined()
    }
  })

  it.each(['strong', 'conflict', 'none'])(
    '%s: blocks until a radio is clicked, then the click is the confirmation',
    async (state) => {
      const wrapper = mountField(STATES[state])
      expect((wrapper.vm as unknown as { validate: () => boolean }).validate()).toBe(false)
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain(BUILD_COPY.required)

      await wrapper.setProps({ modelValue: 'GRCh38' })
      expect((wrapper.vm as unknown as { validate: () => boolean }).validate()).toBe(true)
    }
  )

  it('marks the suggested option on a non-definitive result', () => {
    const wrapper = mountField(STATES.strong)
    expect(wrapper.text()).toContain(`GRCh37 (hg19)${BUILD_COPY.suggestedSuffix}`)
  })

  it('warns, without blocking, when the user overrides definitive lengths', () => {
    const wrapper = mountField(STATES.definitive, 'GRCh38')
    expect(wrapper.text()).toContain(BUILD_COPY.override('GRCh37', 'GRCh38'))
    expect((wrapper.vm as unknown as { validate: () => boolean }).validate()).toBe(true)
  })

  it('blocks a recognised but non-importable build', () => {
    const t2t = GENOME_BUILDS.find((b) => !b.importable)!
    const wrapper = mountField(detectGenomeBuild([contig(t2t.id)]), 'GRCh38')
    expect(wrapper.text()).toContain(BUILD_COPY.notImportable(t2t.label))
    expect((wrapper.vm as unknown as { validate: () => boolean }).validate()).toBe(false)
  })

  it('blocks a multi-file case whose files name different builds', () => {
    const mixed = combineBuildDetections([
      { filePath: 'a.vcf', buildDetection: detectGenomeBuild([contig('GRCh38')]) },
      { filePath: 'b.vcf', buildDetection: detectGenomeBuild([contig('GRCh37')]) }
    ])
    const wrapper = mountField(mixed, 'GRCh38')
    expect(wrapper.text()).toContain(BUILD_COPY.mixedFiles('a.vcf', 'GRCh38', 'b.vcf', 'GRCh37'))
    expect((wrapper.vm as unknown as { validate: () => boolean }).validate()).toBe(false)
  })

  it('exposes the evidence behind an accessible info button', () => {
    const wrapper = mountField(STATES.conflict)
    expect(wrapper.find('[aria-label="Build evidence"]').exists()).toBe(true)
  })
})
