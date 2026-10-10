import { describe, expect, test, vi } from 'vitest'

import { buildDispatcher } from '../../src/web/server/dispatcher'
import type { DispatcherDeps } from '../../src/web/server/dispatcher'
import { WebAssociationRuns } from '../../src/web/server/association/web-association-runs'
import { InvalidParametersError } from '../../src/main/ipc/errors'
import { makeDeps } from './helpers/dispatcher-adapters'

/**
 * Cohort association in web mode (parity PR-W13): runs per user, progress on
 * the caller's SSE stream, cancel only stops the caller's own run.
 */
const CONFIG = {
  groupA_ids: [1, 2],
  groupB_ids: [3, 4],
  primary_test: 'fisher',
  weight_scheme: 'uniform',
  covariates: [],
  filters: {},
  max_threads: 4
}

function sampleGenes() {
  const sample = (group: 0 | 1, dosage: number) => ({
    group,
    dosages: [dosage],
    variant_mafs: [0.25],
    variant_cadds: [null],
    covariate_values: []
  })
  return [
    {
      gene_symbol: 'GENE1',
      groupA_carrier_count: 2,
      groupA_non_carrier_count: 0,
      groupB_carrier_count: 0,
      groupB_non_carrier_count: 2,
      samples: [sample(1, 1), sample(1, 1), sample(0, 0), sample(0, 0)]
    }
  ]
}

function harness(build = vi.fn(async () => ({ genes: sampleGenes(), non_autosomal_variants: 2 }))) {
  const base = makeDeps()
  const publish = vi.fn()
  const association = new WebAssociationRuns({ builder: { build }, events: { publish } })
  const deps = { ...base.deps, association } as DispatcherDeps
  const { overrides } = buildDispatcher(deps)
  const call = async (key: string, args: unknown[], userId = 7) => {
    const reply = { code: vi.fn() }
    const request = { session: { user: { id: userId, username: `u${userId}`, role: 'user' } } }
    const result = await overrides[key].handle(args, request as never, reply as never, deps)
    return { result, reply }
  }
  return { call, publish, build, association }
}

describe('web cohort association', () => {
  test('runs on the server and returns FDR-corrected results', async () => {
    const { call, publish, build } = harness()
    const { result, reply } = await call('cohort:runAssociation', [CONFIG])
    expect(reply.code).not.toHaveBeenCalled()
    expect(build).toHaveBeenCalledWith([1, 2], [3, 4], {}, [])
    const body = result as {
      results: Array<{ gene_symbol: string; q_value: number | null }>
      non_autosomal_variants: number
    }
    expect(body.results.map((r) => r.gene_symbol)).toEqual(['GENE1'])
    expect(body.results[0].q_value).not.toBeNull()
    expect(body.non_autosomal_variants).toBe(2)
    expect(publish).toHaveBeenCalledWith(7, 'cohort:geneBurdenProgress', {
      completed: 1,
      total: 1
    })
  })

  test('invalid config 400, overlapping groups 400', async () => {
    const { call } = harness()
    expect((await call('cohort:runAssociation', [{}])).reply.code).toHaveBeenCalledWith(400)
    const overlap = await call('cohort:runAssociation', [{ ...CONFIG, groupB_ids: [2, 3] }])
    expect(overlap.reply.code).toHaveBeenCalledWith(400)
    expect(overlap.result).toMatchObject({ error: 'association-groups-overlap' })

    const mixedBuild = harness(
      vi.fn(async () => {
        throw new InvalidParametersError(
          'Mixed genome builds: hg19 and hg38',
          'Mixed genome builds: hg19 and hg38'
        )
      })
    )
    const mixed = await mixedBuild.call('cohort:runAssociation', [CONFIG])
    expect(mixed.reply.code).toHaveBeenCalledWith(400)
    expect(mixed.result).toMatchObject({
      error: 'invalid-parameters',
      message: expect.stringContaining('Mixed genome builds')
    })
  })

  test('a second run for the same user is refused; cancel stops only the caller', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const build = vi.fn(async () => {
      await gate
      return { genes: sampleGenes(), non_autosomal_variants: 2 }
    })
    const { call } = harness(build)

    const first = call('cohort:runAssociation', [CONFIG], 7)
    await Promise.resolve()
    const second = await call('cohort:runAssociation', [CONFIG], 7)
    expect(second.reply.code).toHaveBeenCalledWith(409)

    // Another user's cancel does not touch user 7's run.
    await call('cohort:cancelAssociation', [], 8)
    await call('cohort:cancelAssociation', [], 7)
    release()
    const done = (await first).result as { results: unknown[]; warnings: string[] }
    expect(done.results).toEqual([])
    expect(done.warnings).toEqual(['Analysis cancelled'])
  })
})
