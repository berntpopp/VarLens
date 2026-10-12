/**
 * Semantic colour tokens (ACMG, ClinVar, impact, zygosity, scores) must exist in
 * both themes, be readable on the theme's surface, and stay apart under colour
 * vision deficiency (#469, UI/UX audit 2026-10-12 X-08/X-09/C-01): a Material
 * palette name such as `orange` is one colour in both themes, and today's
 * `error`/`warning` pair merges under deuteranopia.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Color from 'colorjs.io'
import { describe, expect, it } from 'vitest'
import {
  ACMG_CLASSIFICATIONS,
  ACMG_COLORS,
  IMPACT_COLORS,
  SEMANTIC_COLORS,
  ZYGOSITY_COLORS
} from '../../../src/shared/config/domain.config'
import {
  CLINVAR_CATEGORIES,
  NEUTRAL_SEVERITY_COLOR
} from '../../../src/shared/config/severity.config'
import { CLINVAR_COLORS } from '../../../src/shared/utils/protein-utils'
import {
  ACMG_FILTER_OPTIONS,
  ACMG_FILTER_OPTIONS_LONG
} from '../../../src/renderer/src/utils/filters/constants'
import { getCaddColor, getImpactColor } from '../../../src/renderer/src/composables/useTableColors'
import { getScoreColor } from '../../../src/renderer/src/utils/scoreThresholds'

const source = readFileSync(
  resolve(__dirname, '../../../src/renderer/src/plugins/vuetify.ts'),
  'utf8'
)

const THEMES = [
  ['warmLight', 'light'],
  ['warmDark', 'dark']
] as const

/** Literal colours of a theme block plus the SEMANTIC_COLORS it spreads in. */
function themeColors(name: string, mode: 'light' | 'dark'): Record<string, string> {
  const start = source.indexOf(`const ${name}: ThemeDefinition`)
  const block = source.slice(start, source.indexOf('variables:', start))
  expect(block).toContain(`...SEMANTIC_COLORS.${mode}`)
  return {
    ...Object.fromEntries(
      [...block.matchAll(/^\s+'?([a-z-]+)'?: '(#[0-9A-Fa-f]{6})'/gm)].map((m) => [m[1], m[2]])
    ),
    ...SEMANTIC_COLORS[mode]
  }
}

// Machado et al. 2009, severity 1.0, applied in linear sRGB.
const CVD: Record<string, number[][] | null> = {
  normal: null,
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998]
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881]
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039]
  ]
}

function simulate(hex: string, m: number[][] | null): Color {
  if (m === null) return new Color(hex)
  const [r, g, b] = new Color(hex).to('srgb-linear').coords as number[]
  const rgb = m.map((row) => Math.min(1, Math.max(0, row[0] * r + row[1] * g + row[2] * b)))
  return new Color('srgb-linear', rgb as [number, number, number])
}

/** Smallest CIEDE2000 distance of two colours over normal and the three dichromacies. */
function minDeltaE(a: string, b: string): number {
  return Math.min(...Object.values(CVD).map((m) => simulate(a, m).deltaE(simulate(b, m), '2000')))
}

const usedTokens = [
  ...CLINVAR_CATEGORIES.map((c) => c.color as string),
  NEUTRAL_SEVERITY_COLOR,
  ...Object.values(ACMG_COLORS),
  ...[...ACMG_FILTER_OPTIONS, ...ACMG_FILTER_OPTIONS_LONG].map((o) => o.color as string),
  ...Object.values(IMPACT_COLORS),
  ...Object.values(ZYGOSITY_COLORS),
  ...['HIGH', 'MODERATE', 'LOW', 'MODIFIER', null, 'x'].map((i) => getImpactColor(i)),
  ...[null, 0, 10, 15, 20, 25].map((v) => getCaddColor(v)),
  ...['cadd', 'revel', 'spliceai', 'unknown'].flatMap((s) =>
    [null, 0, 0.3, 0.6, 0.9, 12, 17, 30].map((v) => getScoreColor(s, v))
  )
]

/** Ordered scales whose neighbours (and all other pairs) must stay distinguishable. */
const SCALES = {
  acmg: ACMG_CLASSIFICATIONS.map((c) => ACMG_COLORS[c]),
  impact: ['HIGH', 'MODERATE', 'LOW', 'MODIFIER'].map((i) => IMPACT_COLORS[i])
}

describe('semantic theme tokens', () => {
  it.each(THEMES)('%s defines every used colour as a token at 4.5:1 or more', (theme, mode) => {
    const colors = themeColors(theme, mode)
    for (const token of new Set(usedTokens)) {
      expect(colors[token], `${theme}.${token}`).toBeDefined()
      expect(Color.contrast(colors[token], colors.surface, 'WCAG21')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(THEMES)('%s keeps every ACMG and impact pair at ΔE00 ≥ 10 under CVD', (theme, mode) => {
    const colors = themeColors(theme, mode)
    for (const [scale, tokens] of Object.entries(SCALES)) {
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const pair = `${theme} ${scale} ${tokens[i]}~${tokens[j]}`
          expect(minDeltaE(colors[tokens[i]], colors[tokens[j]]), pair).toBeGreaterThanOrEqual(10)
        }
      }
    }
  })

  it('filter chips use the row-chip colour of each ACMG class', () => {
    for (const option of [...ACMG_FILTER_OPTIONS, ...ACMG_FILTER_OPTIONS_LONG]) {
      expect(option.color).toBe(ACMG_COLORS[option.value])
    }
  })

  it('protein plots and Mol* paint ClinVar classes in the light ACMG colours', () => {
    const light = SEMANTIC_COLORS.light
    expect([
      CLINVAR_COLORS.pathogenic,
      CLINVAR_COLORS.likely_pathogenic,
      CLINVAR_COLORS.uncertain,
      CLINVAR_COLORS.likely_benign,
      CLINVAR_COLORS.benign
    ]).toEqual(SCALES.acmg.map((token) => light[token as keyof typeof light]))
  })
})
