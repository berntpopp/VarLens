import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { scanTemplates, type ScanFinding } from './template-a11y-scan'

const repoRoot = resolve(__dirname, '../../..')
const rendererRoot = resolve(repoRoot, 'src/renderer/src')

/**
 * Files exempt from the scan. Keep this list short and justified.
 */
const EXEMPT = new Set<string>()

const findings = scanTemplates(rendererRoot, repoRoot).filter((f) => !EXEMPT.has(f.file))

function format(list: ScanFinding[]): string {
  return list.map((f) => `${f.file}:${f.line} ${f.detail}`).join('\n')
}

describe('renderer template accessibility guardrails', () => {
  it('uses SVG icon paths from @mdi/js, never icon="mdi-*" webfont strings', () => {
    const hits = findings.filter((f) => f.rule === 'string-mdi-icon')
    expect(hits, format(hits)).toEqual([])
  })

  it('gives every icon-only v-btn an accessible name (use IconButton or aria-label)', () => {
    const hits = findings.filter((f) => f.rule === 'unnamed-icon-button')
    expect(hits, format(hits)).toEqual([])
  })

  it('never makes a bare v-icon clickable (render a named button instead)', () => {
    const hits = findings.filter((f) => f.rule === 'clickable-icon')
    expect(hits, format(hits)).toEqual([])
  })
})

/** Every `.vue` file under `dir`, recursively. */
function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? vueFiles(join(dir, e.name))
      : e.name.endsWith('.vue')
        ? [join(dir, e.name)]
        : []
  )
}

describe('dark theme guardrails', () => {
  it('gives every fixed light grey background class a dark-theme override', () => {
    const css = readFileSync(join(rendererRoot, 'assets/styles/custom.css'), 'utf8')
    const used = new Set(
      vueFiles(rendererRoot).flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/bg-grey-lighten-\d/g)].map((m) => m[0])
      )
    )
    const missing = [...used].filter((cls) => !css.includes(`.v-theme--warmDark .${cls}`))
    expect(missing).toEqual([])
  })
})
