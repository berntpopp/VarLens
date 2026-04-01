import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData')
  }
}))

vi.mock('../../../../src/main/services/MainLogger', () => ({
  mainLogger: { error: vi.fn(), warn: vi.fn() }
}))

import {
  loadSettings,
  saveSettings,
  settingsPath,
  _deps
} from '../../../../src/main/ipc/utils/settings-io'

describe('settings-io', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('settingsPath', () => {
    it('returns path under userData', () => {
      expect(settingsPath()).toBe(join('/mock/userData', 'settings.json'))
    })
  })

  describe('loadSettings', () => {
    it('returns empty object when file does not exist', async () => {
      vi.spyOn(_deps, 'existsSync').mockReturnValue(false)
      const result = await loadSettings()
      expect(result).toEqual({})
    })

    it('parses JSON when file exists', async () => {
      vi.spyOn(_deps, 'existsSync').mockReturnValue(true)
      vi.spyOn(_deps, 'readFile').mockResolvedValue('{"lastImportDirectory":"/tmp"}')
      const result = await loadSettings()
      expect(result).toEqual({ lastImportDirectory: '/tmp' })
    })

    it('returns empty object on parse error', async () => {
      vi.spyOn(_deps, 'existsSync').mockReturnValue(true)
      vi.spyOn(_deps, 'readFile').mockResolvedValue('not json')
      const result = await loadSettings()
      expect(result).toEqual({})
    })
  })

  describe('saveSettings', () => {
    it('writes JSON to settings path', async () => {
      const writeSpy = vi.spyOn(_deps, 'writeFile').mockResolvedValue(undefined)
      await saveSettings({ lastImportDirectory: '/tmp' })
      expect(writeSpy).toHaveBeenCalledWith(
        settingsPath(),
        JSON.stringify({ lastImportDirectory: '/tmp' }, null, 2)
      )
    })
  })
})
