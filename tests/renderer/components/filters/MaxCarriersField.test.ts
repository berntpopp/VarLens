import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import MaxCarriersField from '../../../../src/renderer/src/components/filters/MaxCarriersField.vue'

const vuetify = createVuetify({ components, directives })

function field(props: { modelValue: number | null; scope: 'case' | 'cohort' }): VueWrapper {
  return mount(MaxCarriersField, { global: { plugins: [vuetify] }, props })
}

async function type(wrapper: VueWrapper, text: string): Promise<unknown> {
  await wrapper.find('input').setValue(text)
  return wrapper.emitted('update:modelValue')?.at(-1)?.[0]
}

describe('MaxCarriersField', () => {
  it('is labelled and says in the case view that this case is included', () => {
    const wrapper = field({ modelValue: null, scope: 'case' })
    expect(wrapper.text()).toContain('Seen in at most N cases')
    expect(wrapper.text()).toContain('including this case')
  })

  it('does not mention "this case" in the cohort view', () => {
    const wrapper = field({ modelValue: null, scope: 'cohort' })
    expect(wrapper.text()).toContain('Seen in at most N cases')
    expect(wrapper.text()).not.toContain('this case')
  })

  it('shows the stored cap', () => {
    const wrapper = field({ modelValue: 3, scope: 'case' })
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('3')
  })

  // Review Focus 1
  it('emits a whole number of cases, and null for anything below 1', async () => {
    const wrapper = field({ modelValue: null, scope: 'case' })
    expect(await type(wrapper, '3')).toBe(3)
    expect(await type(wrapper, '2.7')).toBe(2)
    expect(await type(wrapper, '0')).toBeNull()
    expect(await type(wrapper, '-4')).toBeNull()
    expect(await type(wrapper, '')).toBeNull()
  })
})
