/**
 * Keeps the Vuetify theme in sync with the persisted theme preference and,
 * for the `system` preference, with the OS `prefers-color-scheme` setting.
 *
 * Call once from the app shell (App.vue). The initial theme is already
 * resolved before mount by `plugins/vuetify.ts`, so this only reacts to
 * later changes.
 */
import { onScopeDispose, watch } from 'vue'
import { useTheme } from 'vuetify'
import { useSettingsStore } from '../stores/settingsStore'
import { getSystemDarkQuery, resolveThemeName } from '../utils/theme-preference'

export function useThemePreference(): void {
  const theme = useTheme()
  const settings = useSettingsStore()
  const darkQuery = getSystemDarkQuery()

  function apply(): void {
    const name = resolveThemeName(settings.themePreference, darkQuery?.matches === true)
    if (theme.global.name.value !== name) void theme.change(name)
  }

  watch(() => settings.themePreference, apply, { immediate: true })

  if (darkQuery !== null) {
    const onSystemChange = (): void => {
      if (settings.themePreference === 'system') apply()
    }
    darkQuery.addEventListener('change', onSystemChange)
    onScopeDispose(() => darkQuery.removeEventListener('change', onSystemChange))
  }
}
