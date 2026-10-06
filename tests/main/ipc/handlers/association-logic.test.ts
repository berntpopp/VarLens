import { describe, expect, it, vi } from 'vitest'

import {
  assertDisjointGroups,
  runAssociationInProcess
} from '../../../../src/main/ipc/handlers/association-logic'
import { buildGeneContingencyData } from '../../../../src/main/statistics/contingency'
import { computeGeneAssociation } from '../../../../src/main/statistics/gene-tests'
import { finalizeAssociationResults } from '../../../../src/main/statistics/finalize'
import type { AssociationConfig } from '../../../../src/main/statistics/types'
import { toPostgresFragment } from '../../../../src/main/storage/postgres/PostgresAssociationDataBuilder'

const CONFIG: AssociationConfig = {
  groupA_ids: [1, 2, 3, 4],
  groupB_ids: [5, 6, 7, 8],
  primary_test: 'fisher',
  weight_scheme: 'uniform',
  covariates: [],
  filters: {},
  max_threads: 1
}

function rows() {
  const out = []
  // GENE1: carriers only in group A; GENE2: one carrier per group
  for (const caseId of [1, 2, 3, 4]) {
    out.push({
      gene_symbol: 'GENE1',
      case_id: caseId,
      variant_key: '1:10:A:T',
      dosage: 1,
      gnomad_af: null,
      cadd: 20
    })
  }
  out.push({
    gene_symbol: 'GENE2',
    case_id: 1,
    variant_key: '2:20:C:G',
    dosage: 1,
    gnomad_af: 0.01,
    cadd: null
  })
  out.push({
    gene_symbol: 'GENE2',
    case_id: 5,
    variant_key: '2:20:C:G',
    dosage: 2,
    gnomad_af: 0.01,
    cadd: null
  })
  return out
}

const genes = () =>
  buildGeneContingencyData(rows(), CONFIG.groupA_ids, CONFIG.groupB_ids, new Map())

describe('association-logic (web in-process runner)', () => {
  it('matches the desktop pipeline: per-gene tests + shared FDR/sort tail', async () => {
    const result = await runAssociationInProcess(CONFIG, async () => genes(), { batchSize: 1 })
    const expected = finalizeAssociationResults(
      genes().map((g) => computeGeneAssociation(g, 'uniform')),
      CONFIG,
      Date.now()
    )
    expect(result.results).toEqual(expected.results)
    expect(result.results[0].gene_symbol).toBe('GENE1')
    expect(result.results[0]).toMatchObject({ groupA_carriers: 4, groupB_carriers: 0 })
    expect(result.results[0].q_value).not.toBeNull()
  })

  it('reports progress per batch and stops on abort', async () => {
    const onProgress = vi.fn()
    const controller = new AbortController()
    onProgress.mockImplementation(() => controller.abort())
    const result = await runAssociationInProcess(CONFIG, async () => genes(), {
      batchSize: 1,
      onProgress,
      signal: controller.signal
    })
    expect(onProgress).toHaveBeenCalledWith({ completed: 1, total: 2 })
    expect(result.results).toEqual([])
    expect(result.warnings).toEqual(['Analysis cancelled'])
  })

  it('rejects overlapping groups with the desktop message', async () => {
    expect(() => assertDisjointGroups({ groupA_ids: [1, 2], groupB_ids: [2, 3] })).toThrow(
      'Groups overlap: case IDs 2 appear in both groups'
    )
    await expect(
      runAssociationInProcess({ ...CONFIG, groupB_ids: [1] }, async () => genes())
    ).rejects.toThrow(/Groups overlap/)
  })

  it('no qualifying genes → empty result with a warning', async () => {
    const result = await runAssociationInProcess(CONFIG, async () => [])
    expect(result.warnings).toEqual(['No genes with qualifying variants'])
  })
})

describe('toPostgresFragment', () => {
  it('numbers placeholders, maps NOCASE LIKE to ILIKE and qualifies extension tables', () => {
    const { sql, next } = toPostgresFragment(
      'v.gene_symbol IN (?, ?) AND v.consequence LIKE ? COLLATE NOCASE',
      3,
      '"s"'
    )
    expect(sql).toBe('v.gene_symbol IN ($3, $4) AND v.consequence ILIKE $5')
    expect(next).toBe(6)
    expect(
      toPostgresFragment('LEFT JOIN variant_cnv cnv ON cnv.variant_id = v.id', 1, '"s"').sql
    ).toBe('LEFT JOIN "s"."variant_cnv" cnv ON cnv.variant_id = v.id')
  })
})
