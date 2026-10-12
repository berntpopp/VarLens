/** "Save as default" stores the edited profile itself (deleted overrides stay deleted). */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import ImportFieldProfileTable from '../../../../src/renderer/src/components/import/ImportFieldProfileTable.vue'
import { useSettingsStore } from '../../../../src/renderer/src/stores/settingsStore'
import type { ImportFieldProfile } from '../../../../src/shared/config/import-fields.config'
import type { ImportFieldPreview } from '../../../../src/shared/types/import'

vi.mock('../../../../src/renderer/src/services/LogService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const vuetify = createVuetify({ components, directives })
const fields: ImportFieldPreview[] = [
  { origin: 'JSON', name: 'RevelScore', column: null, type: 'number', fillRate: 1, samples: [] }
]

describe('ImportFieldProfileTable save as default', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('saves the edited profile, so a removed override does not come back', async () => {
    const settings = useSettingsStore()
    settings.importFieldProfile = {
      keepUnknown: 'all',
      fields: { 'JSON:RevelScore': { keep: false } }
    }
    const profile = ref<ImportFieldProfile>(settings.importFieldProfile)
    const wrapper = mount(ImportFieldProfileTable, {
      props: {
        fields,
        canSaveDefault: true,
        modelValue: profile.value,
        'onUpdate:modelValue': (value: ImportFieldProfile) => {
          profile.value = value
          void wrapper.setProps({ modelValue: value })
        }
      },
      global: { plugins: [vuetify] }
    })
    // Re-check RevelScore: back to the default (keep), so its override is dropped.
    await wrapper.find('input[aria-label="Keep RevelScore"]').setValue(true)
    await nextTick()
    expect(profile.value.fields).toEqual({})

    await wrapper.find('[data-testid="field-profile-save-default"]').trigger('click')
    expect(settings.importFieldProfile).toEqual({ keepUnknown: 'all', fields: {} })
  })
})
