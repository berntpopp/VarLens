import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildContentSecurityPolicy } from '../../src/main/security/csp-header'

const HTML_PATHS = {
  renderer: resolve(__dirname, '../../src/renderer/index.html'),
  web: resolve(__dirname, '../../src/web/index.html')
}

describe('index.html first paint (renderer + web)', () => {
  for (const [name, path] of Object.entries(HTML_PATHS)) {
    const html = readFileSync(path, 'utf-8')

    it(`${name}: loads no third-party fonts (no render-blocking Google Fonts)`, () => {
      expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/)
    })

    it(`${name}: declares the light color-scheme and a pre-mount theme background`, () => {
      expect(html).toMatch(/<meta\s+name="color-scheme"\s+content="light"\s*\/?>/)
      // Must equal the Vuetify light theme `background` token (plugins/vuetify.ts).
      expect(html.toLowerCase()).toContain('background: #f0f4f8')
    })
  }

  it('session CSP header allows fonts from self only', () => {
    const csp = buildContentSecurityPolicy()
    expect(csp).toContain("font-src 'self';")
    expect(csp).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/)
  })
})
