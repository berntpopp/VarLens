import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertOutsideRepo, REPO_ROOT } from '../../../../scripts/shortlist-sim/common/paths'
import { acceptanceOf } from '../../../../scripts/shortlist-sim/sim/inputs'
import { describeBackground } from '../../../../scripts/shortlist-sim/sim/background-db'
import { buildCases } from '../../../../scripts/shortlist-sim/sim/cases'
import type { SpikeSource } from '../../../../scripts/shortlist-sim/sim/spikes'
import { evaluateShip } from '../../../../scripts/shortlist-sim/stats/ship'
import type { ConcordanceReport } from '../../../../scripts/shortlist-sim/concordance/metrics'
import { GENES, poolSpike, SPIKE_OPTIONS, syntheticBackground } from './fixtures'

describe('private data never inside the repository (finding 7)', () => {
  it('rejects repo paths, also through a symlink and for a not-yet-existing tail', () => {
    expect(() => assertOutsideRepo(join(REPO_ROOT, '.planning/artifacts/x/private'))).toThrow()
    const outside = mkdtempSync(join(tmpdir(), 'sim-guard-'))
    const link = join(outside, 'into-repo')
    symlinkSync(REPO_ROOT, link)
    expect(() => assertOutsideRepo(join(link, 'new/dir'))).toThrow()
    mkdirSync(join(outside, 'ok'))
    expect(assertOutsideRepo(join(outside, 'ok/private'))).toBe(join(outside, 'ok/private'))
  })
})

describe('annotation acceptance needs an explicit pass (finding 8)', () => {
  const report = (
    pass: Partial<Record<'afPass' | 'caddPass' | 'poolAfPass' | 'poolCaddPass', boolean | null>>
  ) =>
    ({
      afField: [],
      cadd: { n: 0, medianAbsErr: null, pearson: null },
      pool: null,
      acceptance: {
        afField: 'exome',
        afPass: true,
        caddPass: true,
        poolAfPass: true,
        poolCaddPass: true,
        ...pass
      }
    }) as unknown as ConcordanceReport

  it('disables a group whose check is not evaluable and marks the run provisional', () => {
    const a = acceptanceOf(report({ poolCaddPass: null }))
    expect(a.disabledGroups).toEqual(['cadd'])
    expect(a.provisional).toBe(true)
    expect(acceptanceOf(report({})).provisional).toBe(false)
  })

  it('never ships on provisional inputs', () => {
    const ok = { estimate: 0.2, lo: 0.1, hi: 0.3 }
    const zero = { estimate: 0, lo: -0.1, hi: 0 }
    const input = {
      testGeneClusters: 1000,
      modeCases: { AD: 100 },
      primary: { deltaHit10: ok, deltaDecoys: zero },
      clinvarVisible: { deltaHit10: ok, deltaDecoys: zero },
      sensitivity: { n: 1000, failures: 0 }
    }
    expect(evaluateShip(input).ship).toBe(true)
    expect(evaluateShip({ ...input, provisional: true }).ship).toBe(false)
  })
})

describe('CADD imputation has its own random stream (finding 12)', () => {
  it('toggling imputation leaves genotypes and decoys identical', () => {
    const bg = syntheticBackground()
    const info = describeBackground('bg1', bg.rows)
    const sources = new Map<string, SpikeSource>()
    const add = (s: SpikeSource): void => void sources.set(s.pv.key, s)
    for (let i = 0; i < 4; i++) {
      // Indels in a func the background has as indels, so imputation really draws.
      const s = poolSpike(GENES[1 + i], { moi: 'AD' }, 'missense_variant')
      add({ ...s, caddApi: undefined, norm: { ...s.norm, alt: 'CAT', key: `${s.norm.key}AT` } })
    }
    for (let i = 0; i < 15; i++)
      add(poolSpike(GENES[8 + i], { label: 'benign', moi: null }, 'missense_variant', 0.001))
    const pool = [...sources.values()].map((s) => s.pv)
    const run = (caddImpute: boolean) =>
      buildCases(pool, sources, [{ info, normKeys: new Set() }], 5, {
        ...SPIKE_OPTIONS,
        caddImpute
      }).cases.map((c) =>
        [c.causal, c.decoys].flat().map((s) => `${s.poolKey}|${s.row.gt_num}|${s.row.qual}`)
      )
    expect(run(false)).toEqual(run(true))
    const sources1 = buildCases(pool, sources, [{ info, normKeys: new Set() }], 5, SPIKE_OPTIONS)
    expect(sources1.caddSources.imputed).toBeGreaterThan(0)
  })
})
