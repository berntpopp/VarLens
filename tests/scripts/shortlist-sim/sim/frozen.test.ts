// `--frozen` (#584): a pre-registered ruleset is validated and evaluated unchanged, never tuned.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { foldRulesets, loadFrozenRuleset } from '../../../../scripts/shortlist-sim/sim/protocol'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../../src/shared/config/evidence-rulesets/varvis-template'

const write = (value: unknown): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'frozen-')), 'ruleset.json')
  writeFileSync(file, JSON.stringify(value))
  return file
}

describe('--frozen', () => {
  it('loads a valid ruleset and rejects one that fails the ruleset validation', () => {
    expect(loadFrozenRuleset(write(VARVIS_EVIDENCE_TEMPLATE))).toEqual(VARVIS_EVIDENCE_TEMPLATE)
    const broken = { ...VARVIS_EVIDENCE_TEMPLATE, modes: [] }
    expect(() => loadFrozenRuleset(write(broken))).toThrow()
  })

  it('skips tuning and uses the frozen ruleset unchanged in every fold', async () => {
    const tune = vi.fn()
    const out = await foldRulesets(VARVIS_EVIDENCE_TEMPLATE, 'varvis', 5, tune)
    expect(tune).not.toHaveBeenCalled()
    expect(out.tunings).toBeUndefined()
    expect(out.tunedBy.varvis).toHaveLength(5)
    for (const rs of out.tunedBy.varvis!) expect(rs).toBe(VARVIS_EVIDENCE_TEMPLATE)
  })

  it('tunes when no ruleset is frozen', async () => {
    const perFold = [VARVIS_EVIDENCE_TEMPLATE]
    const tune = vi.fn(async () => ({ varvis: { perFold, refit: {} } }) as never)
    const out = await foldRulesets(undefined, 'varvis', 1, tune)
    expect(tune).toHaveBeenCalledOnce()
    expect(out.tunedBy.varvis).toBe(perFold)
  })
})
