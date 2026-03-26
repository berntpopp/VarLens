import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import { mainLogger } from '../../services/MainLogger'

export interface ImportSettings {
  lastImportDirectory?: string
}

export const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

/** Internal deps for testing. */
export const _deps = {
  existsSync,
  readFile,
  writeFile
}

export async function loadSettings(): Promise<ImportSettings> {
  try {
    if (_deps.existsSync(settingsPath())) {
      const data = await _deps.readFile(settingsPath(), 'utf8')
      return JSON.parse(data as string)
    }
  } catch {
    // Ignore parse errors, return empty
  }
  return {}
}

export async function saveSettings(settings: ImportSettings): Promise<void> {
  try {
    await _deps.writeFile(settingsPath(), JSON.stringify(settings, null, 2))
  } catch (error) {
    mainLogger.error(`Failed to save settings: ${error}`, 'import')
  }
}
