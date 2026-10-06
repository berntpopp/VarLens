/**
 * Runs the renderer parity gate (scripts/parity/check-renderer-gates.mjs) in
 * the default `make test`, so CI fails when a renderer call of a desktop-only
 * or pending window.api method is not capability-gated. `make agent-check`
 * runs the same script directly.
 */
import { describe, expect, it } from 'vitest'

// @ts-expect-error -- plain ESM script without type declarations
import { findUngatedCalls, loadGatedMethods } from '../../scripts/parity/check-renderer-gates.mjs'

interface Violation {
  file: string
  method: string
  feature: string
}

describe('renderer parity gate', () => {
  it('reads every desktop-only and pending method with its capability from the manifest', () => {
    const gated = loadGatedMethods() as { domain: string; method: string; feature: string }[]
    const keys = gated.map((g) => `${g.domain}.${g.method}`)
    expect(keys).toContain('database.open')
    expect(keys).toContain('hpo.search')
    expect(gated.find((g) => g.domain === 'hpo' && g.method === 'search')?.feature).toBe(
      'hpoSearch'
    )
  })

  it('finds no ungated renderer call', () => {
    const { violations } = findUngatedCalls() as { violations: Violation[] }
    expect(violations.map((v) => `${v.file}: ${v.method} needs canUse('${v.feature}')`)).toEqual([])
  })
})
