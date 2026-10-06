/**
 * Theme preference resolution (pure helpers, no Vue / Vuetify imports).
 *
 * The user picks `system` (follow the OS `prefers-color-scheme`), `light` or
 * `dark`; Vuetify knows the concrete theme names `warmLight` / `warmDark`.
 * `vuetify.ts` resolves the initial theme synchronously from localStorage so
 * the first paint already uses the right palette (no light flash for
 * dark-OS users), and `useThemePreference` keeps it in sync afterwards.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ThemeName = 'warmLight' | 'warmDark'

export const THEME_PREFERENCE_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

/** Same key/shape as `settingsStore` — the store owns writes. */
export const SETTINGS_STORAGE_KEY = 'varlens_user_settings_v1'

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function resolveThemeName(
  preference: ThemePreference,
  systemPrefersDark: boolean
): ThemeName {
  if (preference === 'dark') return 'warmDark'
  if (preference === 'light') return 'warmLight'
  return systemPrefersDark ? 'warmDark' : 'warmLight'
}

/** Reads the persisted preference without Pinia (safe before app mount). */
export function readStoredThemePreference(
  storage: Pick<Storage, 'getItem'> | null
): ThemePreference {
  try {
    const raw = storage?.getItem(SETTINGS_STORAGE_KEY)
    if (raw === null || raw === undefined || raw === '') return DEFAULT_THEME_PREFERENCE
    const parsed = JSON.parse(raw) as { themePreference?: unknown }
    return isThemePreference(parsed.themePreference)
      ? parsed.themePreference
      : DEFAULT_THEME_PREFERENCE
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function getSystemDarkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(DARK_QUERY)
}

/** Initial Vuetify theme name, resolved before the app mounts. */
export function resolveInitialThemeName(): ThemeName {
  let storage: Pick<Storage, 'getItem'> | null
  try {
    storage = typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    storage = null
  }
  return resolveThemeName(
    readStoredThemePreference(storage),
    getSystemDarkQuery()?.matches === true
  )
}
