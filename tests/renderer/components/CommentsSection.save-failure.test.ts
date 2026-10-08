import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

const upsertGlobalComment = vi.fn<() => Promise<boolean>>()

vi.mock('../../../src/renderer/src/composables/useAnnotations', () => ({
  useAnnotations: () => ({
    getAnnotations: () => null,
    upsertGlobalComment,
    upsertPerCaseComment: vi.fn(),
    deleteGlobalComment: vi.fn(),
    deletePerCaseComment: vi.fn()
  })
}))
vi.mock('../../../src/renderer/src/composables/usePermissions', () => ({
  usePermissions: () => ({ canWrite: computed(() => true) })
}))

import CommentsSection from '../../../src/renderer/src/components/CommentsSection.vue'

const vuetify = createVuetify({ components, directives })
const variant = { chr: '1', pos: 100, ref: 'A', alt: 'T' }

async function typeGlobalComment(text: string) {
  const wrapper = mount(CommentsSection, {
    props: { variant: variant as never, caseId: null, mode: 'cohort' },
    global: { plugins: [vuetify] }
  })
  await wrapper.find('.editable-text').trigger('click')
  const textarea = wrapper.find('textarea')
  await textarea.setValue(text)
  await textarea.trigger('blur')
  await flushPromises()
  return wrapper
}

describe('CommentsSection inline comment save', () => {
  beforeEach(() => upsertGlobalComment.mockReset())

  it('keeps the typed comment in the editor when the save fails', async () => {
    upsertGlobalComment.mockResolvedValue(false)
    const wrapper = await typeGlobalComment('likely causal')

    expect(upsertGlobalComment).toHaveBeenCalledWith('1', 100, 'A', 'T', 'likely causal')
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.find('textarea').element.value).toBe('likely causal')
  })

  it('leaves edit mode once the comment is saved', async () => {
    upsertGlobalComment.mockResolvedValue(true)
    const wrapper = await typeGlobalComment('likely causal')

    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('does not carry an unsaved comment over to another variant', async () => {
    upsertGlobalComment.mockResolvedValue(false)
    const wrapper = await typeGlobalComment('likely causal')

    await wrapper.setProps({ variant: { ...variant, pos: 200 } as never })

    expect(wrapper.find('textarea').exists()).toBe(false)
  })
})
