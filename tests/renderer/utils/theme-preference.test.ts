import { describe, expect, it } from 'vitest'
import {
  SETTINGS_STORAGE_KEY,
  readStoredThemePreference,
  resolveThemeName
} from '../../../src/renderer/src/utils/theme-preference'

function storageWith(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: (key: string) => (key === SETTINGS_STORAGE_KEY ? value : null) }
}

describe('resolveThemeName', () => {
  it('maps explicit preferences regardless of the OS setting', () => {
    expect(resolveThemeName('light', true)).toBe('warmLight')
    expect(resolveThemeName('dark', false)).toBe('warmDark')
  })

  it('follows prefers-color-scheme for the system preference', () => {
    expect(resolveThemeName('system', true)).toBe('warmDark')
    expect(resolveThemeName('system', false)).toBe('warmLight')
  })
})

describe('readStoredThemePreference', () => {
  it('defaults to system when nothing is stored', () => {
    expect(readStoredThemePreference(storageWith(null))).toBe('system')
    expect(readStoredThemePreference(null)).toBe('system')
  })

  it('reads the persisted settings blob', () => {
    const raw = JSON.stringify({ itemsPerPage: 25, themePreference: 'dark' })
    expect(readStoredThemePreference(storageWith(raw))).toBe('dark')
  })

  it('ignores invalid or corrupt values', () => {
    expect(readStoredThemePreference(storageWith('{"themePreference":"neon"}'))).toBe('system')
    expect(readStoredThemePreference(storageWith('{not json'))).toBe('system')
  })

  it('survives a throwing storage accessor', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      }
    }
    expect(readStoredThemePreference(throwing)).toBe('system')
  })
})
