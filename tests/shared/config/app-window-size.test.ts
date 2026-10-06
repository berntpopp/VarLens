import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_CONFIG } from '../../../src/shared/config/app.config'

describe('Electron window size bounds', () => {
  it('declares a 1024x640 minimum that fits inside the default size', () => {
    expect(APP_CONFIG.WINDOW_MIN_WIDTH).toBe(1024)
    expect(APP_CONFIG.WINDOW_MIN_HEIGHT).toBe(640)
    expect(APP_CONFIG.WINDOW_MIN_WIDTH).toBeLessThanOrEqual(APP_CONFIG.WINDOW_WIDTH)
    expect(APP_CONFIG.WINDOW_MIN_HEIGHT).toBeLessThanOrEqual(APP_CONFIG.WINDOW_HEIGHT)
  })

  it('passes the minimum to the main BrowserWindow', () => {
    const source = readFileSync(join(__dirname, '../../../src/main/index.ts'), 'utf8')
    expect(source).toContain('minWidth: APP_CONFIG.WINDOW_MIN_WIDTH')
    expect(source).toContain('minHeight: APP_CONFIG.WINDOW_MIN_HEIGHT')
  })
})
