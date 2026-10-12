/**
 * The resolved theme is mirrored onto <html data-theme>, so the pre-mount CSS
 * in index.html (html/body background, scrollbar gutter) follows the app theme.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import { useThemePreference } from '../../../src/renderer/src/composables/useThemePreference'
import { useSettingsStore } from '../../../src/renderer/src/stores/settingsStore'

const Host = defineComponent({
  setup() {
    useThemePreference()
    return () => null
  }
})

describe('useThemePreference', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme
  })

  it('sets data-theme on <html> from the preference', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const vuetify = createVuetify({
      theme: { defaultTheme: 'warmLight', themes: { warmLight: {}, warmDark: { dark: true } } }
    })
    const settings = useSettingsStore()
    settings.themePreference = 'light'
    const wrapper = mount(Host, { global: { plugins: [pinia, vuetify] } })
    expect(document.documentElement.dataset.theme).toBe('light')

    settings.themePreference = 'dark'
    await nextTick()
    expect(document.documentElement.dataset.theme).toBe('dark')
    wrapper.unmount()
  })
})
