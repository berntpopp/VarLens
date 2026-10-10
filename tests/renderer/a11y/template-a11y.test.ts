import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
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
