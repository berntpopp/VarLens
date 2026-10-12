import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
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

    it(`${name}: paints the theme background before mount, light or dark`, () => {
      expect(html).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"\s*\/?>/)
      // Must equal the Vuetify themes' `background` tokens (plugins/vuetify.ts).
      const css = html.toLowerCase()
      expect(css).toContain('background: #f0f4f8')
      // Dark OS before mount (unless the app chose light), and an app-chosen dark theme.
      expect(css).toMatch(
        /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)[^}]*background: #12141a/
      )
      expect(css).toMatch(/:root\[data-theme='dark'\][^}]*background: #12141a/)
      // No inline script: the CSP (script-src 'self') would block it.
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
    })
  }

  it('session CSP header allows fonts from self only', () => {
    const csp = buildContentSecurityPolicy()
    expect(csp).toContain("font-src 'self';")
    expect(csp).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/)
  })
  it('bundles only the Latin variable faces, from installed packages', () => {
    const css = readFileSync(
      resolve(__dirname, '../../src/renderer/src/assets/styles/fonts.css'),
      'utf-8'
    )
    const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1])
    expect(urls).toHaveLength(2)
    for (const url of urls) {
      expect(url).toMatch(/^@fontsource-variable\/[\w-]+\/files\/[\w-]+-latin-wght-normal\.woff2$/)
      expect(existsSync(resolve(__dirname, '../../node_modules', url))).toBe(true)
    }
  })
})
