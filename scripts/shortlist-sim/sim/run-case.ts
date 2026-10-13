/**
 * Rank one simulated case with the production shortlist service (spec §6, Task 12 Step 4):
 * SAVEPOINT → insert the spikes with `insertBatch` → `rankCase(..., Infinity)` per scorer →
 * ROLLBACK, so the background is unchanged for the next case.
 */
import type { ShortlistRow, ShortlistConfig } from '../../../src/shared/types/shortlist'
import type { AlleleRank, CaseResult, ScenarioId } from '../common/types'
import type { BackgroundDb } from './background-db'
import type { SimCase } from './cases'
import type { GeneFields } from './scenarios'
import { applyScenarioToSpike } from './scenarios'
import { runsIn, type ScorerDef } from './scorers'
import { alleleClassOf } from './background-db'

export interface SpikedIds {
  causal: number[]
  decoys: Set<number>
}

const GENE_FIELDS: ReadonlyArray<keyof GeneFields> = ['omim_mim_number', 'moi', 'hpo_sim_score']

/** Run `fn` with the case's spikes inserted; always rolled back afterwards. */
export function withSpikes<T>(
  bg: BackgroundDb,
  c: SimCase,
  rnd: () => number,
  fn: (ids: SpikedIds) => T
): T {
  const { db, caseId, scenario } = bg
  const before = (
    db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM variants').get() as { m: number }
  ).m
  db.exec('SAVEPOINT sim_case')
  try {
    const spikes = [...c.causal, ...c.decoys]
    bg.repos.variants.insertBatch(
      spikes.map((s) => applyScenarioToSpike(s.row, scenario, bg, rnd)),
      caseId
    )
    if (scenario === 'missingness') dropGeneFields(bg, c.gene, rnd)
    const ids = (
      db
        .prepare('SELECT id FROM variants WHERE case_id = ? AND id > ? ORDER BY id')
        .all(caseId, before) as Array<{ id: number }>
    ).map((r) => r.id)
    if (ids.length !== spikes.length)
      throw new Error(`${c.id}: inserted ${ids.length}/${spikes.length}`)
    return fn({
      causal: ids.slice(0, c.causal.length),
      decoys: new Set(ids.slice(c.causal.length))
    })
  } finally {
    db.exec('ROLLBACK TO sim_case')
    db.exec('RELEASE sim_case')
  }
}

/** Missingness scenario: each gene-level field drops for the whole gene with the background's rate. */
function dropGeneFields(bg: BackgroundDb, gene: string, rnd: () => number): void {
  for (const f of GENE_FIELDS) {
    if (rnd() < bg.geneMissingShare[f]) {
      bg.db
        .prepare(`UPDATE variants SET ${f} = NULL WHERE case_id = ? AND gene_symbol = ?`)
        .run(bg.caseId, gene)
    }
  }
}

const partition = (r: ShortlistRow): number =>
  (r.rank_starred_pinned ? 0 : 2) + (r.rank_clinvar_pinned ? 0 : 1)

/** Production rank and tie statistics of row `id` in a complete ordering. */
export function alleleRank(rows: readonly ShortlistRow[], id: number): AlleleRank {
  const self = rows.find((r) => r.id === id)
  if (self === undefined) return { rank: null, higher: 0, equal: 0 }
  const p = partition(self)
  let higher = 0
  let equal = 0
  for (const r of rows) {
    if (r.id === id) continue
    const q = partition(r)
    if (q < p || (q === p && r.rank_score > self.rank_score)) higher++
    else if (q === p && r.rank_score === self.rank_score) equal++
  }
  return { rank: self.rank, higher, equal }
}

export function rankAll(
  bg: BackgroundDb,
  config: ShortlistConfig
): { rows: ShortlistRow[]; total: number } {
  const res = bg.repos.shortlistService.rankCase(
    { caseId: bg.caseId, adHocConfig: config },
    () => null,
    Number.POSITIVE_INFINITY
  )
  return { rows: res.rows, total: res.totalCandidates }
}

export function runCase(
  bg: BackgroundDb,
  c: SimCase,
  scorers: readonly ScorerDef[],
  fold: number,
  rnd: () => number
): CaseResult[] {
  const scenario: ScenarioId = bg.scenario
  const snvOnly = c.causal.every((s) => alleleClassOf(s.row.ref, s.row.alt) === 'snv')
  return withSpikes(bg, c, rnd, (ids) =>
    scorers
      .filter((s) => runsIn(s, scenario))
      .map((s): CaseResult => {
        const { rows, total } = rankAll(bg, s.config(fold))
        const alleles = ids.causal.map((id) => alleleRank(rows, id))
        return {
          caseId: c.id,
          scorer: s.id,
          scenario,
          fold,
          mode: c.mode,
          consequenceClass: c.consequenceClass,
          bg: c.bg,
          gene: c.gene,
          newSince2024: c.newSince2024,
          snvOnly,
          alleles,
          decoysTop10: rows.slice(0, 10).filter((r) => ids.decoys.has(r.id)).length,
          eligible: total,
          causalEligible: alleles.map((a) => a.rank !== null)
        }
      })
  )
}
