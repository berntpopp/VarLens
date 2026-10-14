/**
 * Backgrounds for the simulation (spec §4.1): aggregate statistics of a background and an
 * in-memory SQLite copy built with the production schema, migrations and
 * `VariantRepository.insertBatch`. Rows never leave the process.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import {
  createRepositories,
  type Repositories
} from '../../../src/main/database/createRepositories'
import { alleleKey } from '../../../src/main/services/scoring/evidence'
import { genotypeZygosity } from '../../../src/shared/utils/genotype'
import { isInPAR } from '../../../src/shared/utils/par-regions'
import { normalizeContigName } from '../../../src/shared/sql/chromosome-order'
import type { Background, MappedVariant } from '../concordance/load-backgrounds'
import { rng } from '../common/rng'
import {
  applyScenarioToBackground,
  type GeneFields,
  type ScenarioId,
  type SpikeScenarioContext
} from './scenarios'

export type AlleleClass = 'snv' | 'indel'
export const alleleClassOf = (ref: string, alt: string): AlleleClass =>
  ref.length === 1 && alt.length === 1 ? 'snv' : 'indel'

/**
 * Sex inference from chrX outside the PARs: a male has no true chrX hets (only artefacts), a
 * female about as many as on the autosomes, so a het share below `maleMaxHetShare` means male;
 * fewer than `minCalls` calls give no call at all.
 */
export const SEX_INFERENCE = { maleMaxHetShare: 0.2, minCalls: 10 } as const
export type InferredSex = 'male' | 'female' | null

export const onChrXNonPar = (r: Pick<MappedVariant, 'chr' | 'pos'>): boolean =>
  normalizeContigName(r.chr) === 'X' && !isInPAR(r.chr, r.pos, 'GRCh38')

export function inferSex(rows: readonly MappedVariant[]): InferredSex {
  let calls = 0
  let het = 0
  for (const r of rows) {
    const zyg = onChrXNonPar(r) ? genotypeZygosity(r.gt_num) : null
    if (zyg === null) continue
    calls++
    if (zyg === 'het') het++
  }
  if (calls < SEX_INFERENCE.minCalls) return null
  return het / calls < SEX_INFERENCE.maleMaxHetShare ? 'male' : 'female'
}

/**
 * `${class}:${zygosity}` → observed [gt_num, qual] pairs; `hemi` holds a male background's
 * chrX non-PAR alt calls, so an XL spike copies its varvis encoding.
 */
export type EncodingStats = Record<string, Array<[string | null, number | null]>>

export interface BackgroundInfo extends SpikeScenarioContext {
  label: string
  sex: InferredSex
  rowCount: number
  genes: Set<string>
  encodings: EncodingStats
  /** `${func}|${class}` → varvis CADD values incl. null (for CADD imputation). */
  caddByFuncClass: Map<string, Array<number | null>>
  /** Share of genes lacking each gene-level field (missingness scenario). */
  geneMissingShare: Record<keyof GeneFields, number>
  /** Production allele identity of every background row. */
  prodKeys: Set<string>
}

export interface BackgroundDb extends BackgroundInfo {
  db: DatabaseType
  caseId: number
  repos: Repositories
  scenario: ScenarioId
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

function geneStats(
  rows: readonly MappedVariant[]
): Pick<BackgroundInfo, 'genes' | 'geneFields' | 'geneMissingShare'> {
  const geneFields = new Map<string, GeneFields>()
  for (const r of rows) {
    if (r.gene_symbol === null || geneFields.has(r.gene_symbol)) continue
    geneFields.set(r.gene_symbol, {
      omim_mim_number: r.omim_mim_number,
      moi: r.moi,
      hpo_sim_score: r.hpo_sim_score
    })
  }
  const n = Math.max(geneFields.size, 1)
  const share = (f: keyof GeneFields): number =>
    [...geneFields.values()].filter((g) => g[f] === null).length / n
  return {
    genes: new Set(geneFields.keys()),
    geneFields,
    geneMissingShare: {
      omim_mim_number: share('omim_mim_number'),
      moi: share('moi'),
      hpo_sim_score: share('hpo_sim_score')
    }
  }
}

/** Aggregate view of background rows (already scenario-applied when used for a DB). */
export function describeBackground(label: string, rows: readonly MappedVariant[]): BackgroundInfo {
  const encodings: EncodingStats = {}
  const missingByFunc = new Map<string, Array<[boolean, boolean]>>()
  const caddByFuncClass = new Map<string, Array<number | null>>()
  const prodKeys = new Set<string>()
  const sex = inferSex(rows)
  for (const r of rows) {
    const cls = alleleClassOf(r.ref, r.alt)
    const gtZyg = genotypeZygosity(r.gt_num)
    const zyg =
      sex === 'male' && (gtZyg === 'hom' || gtZyg === 'hemi') && onChrXNonPar(r) ? 'hemi' : gtZyg
    if (zyg === 'het' || zyg === 'hom' || zyg === 'hemi')
      (encodings[`${cls}:${zyg}`] ??= []).push([r.gt_num, r.qual])
    if (r.func !== null) {
      push(missingByFunc, r.func, [r.gnomad_af === null, r.cadd === null] as [boolean, boolean])
      push(caddByFuncClass, `${r.func}|${cls}`, r.cadd)
    }
    prodKeys.add(alleleKey(r))
  }
  return {
    label,
    sex,
    rowCount: rows.length,
    encodings,
    missingByFunc,
    caddByFuncClass,
    prodKeys,
    ...geneStats(rows)
  }
}

const labelSeed = (label: string, seed: number): number =>
  [...label].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, seed >>> 0)

/** In-memory production database holding one background under one scenario. */
export function openBackgroundDb(bg: Background, scenario: ScenarioId, seed: number): BackgroundDb {
  const rows = applyScenarioToBackground(bg.rows, scenario, rng(labelSeed(bg.caseLabel, seed)))
  const db = new Database(':memory:')
  initializeSchema(db)
  runMigrations(db)
  const caseId = 1
  db.prepare(
    `INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at, genome_build)
     VALUES (?, ?, 'simulation', 0, ?, 0, 'GRCh38')`
  ).run(caseId, bg.caseLabel, rows.length)
  const info = describeBackground(bg.caseLabel, rows)
  // The ranking reads case sex from case_metadata (male chrX non-PAR hom → hemizygous).
  if (info.sex !== null)
    db.prepare(
      `INSERT INTO case_metadata (case_id, sex, created_at, updated_at) VALUES (?, ?, 0, 0)`
    ).run(caseId, info.sex)
  const repos = createRepositories(db)
  repos.variants.insertBatch(rows, caseId)
  return { ...info, db, caseId, repos, scenario }
}

/** Number of variant rows of the case (rollback checks). */
export function variantCount(bg: BackgroundDb): number {
  return (
    bg.db.prepare('SELECT COUNT(*) AS n FROM variants WHERE case_id = ?').get(bg.caseId) as {
      n: number
    }
  ).n
}
