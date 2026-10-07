/**
 * ClinVar chip colours that are theme tokens must exist in both themes and be
 * readable on the theme's surface (#469): a Material palette name such as
 * `deep-purple` is the same colour in light and dark.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLINVAR_CATEGORIES } from '../../../src/shared/config/severity.config'

const source = readFileSync(
  resolve(__dirname, '../../../src/renderer/src/plugins/vuetify.ts'),
  'utf8'
)

function themeColors(name: string): Record<string, string> {
  const start = source.indexOf(`const ${name}: ThemeDefinition`)
  const block = source.slice(start, source.indexOf('variables:', start))
  return Object.fromEntries(
    [...block.matchAll(/^\s+'?([a-z-]+)'?: '(#[0-9A-Fa-f]{6})'/gm)].map((m) => [m[1], m[2]])
  )
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('ClinVar chip theme tokens', () => {
  const tokens = [...new Set(CLINVAR_CATEGORIES.map((c) => c.color as string))].filter((c) =>
    c.startsWith('clinvar-')
  )

  it('the conflicting category uses a theme token, not a fixed palette colour', () => {
    expect(tokens).toContain('clinvar-conflicting')
  })

  it.each(['warmLight', 'warmDark'])('%s defines every token at 4.5:1 or more', (theme) => {
    const colors = themeColors(theme)
    expect(colors.surface).toBeDefined()
    for (const token of ['clinvar-conflicting', ...tokens]) {
      expect(colors[token], `${theme}.${token}`).toBeDefined()
      expect(contrast(colors[token], colors.surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
