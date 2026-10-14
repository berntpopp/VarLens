/**
 * `hpo_similarity.db`: unencrypted, read-only reference data for the in-app
 * Resnik score (#600), like gene_reference.db. Built by `buildHpoSimilarityDb`
 * from the HPO release files; loaded into a typed-array index once per process
 * and reloaded when the file's mtime/size change, so an update's atomic rename
 * is picked up without a reopen hook (no handle stays open). Safe in worker
 * threads and the web server: no Electron imports.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { existsSync, rmSync, statSync } from 'fs'
import { HPO_DATA_CONFIG } from '../../../shared/config/hpo-data.config'
import type { HpoDataStatus } from '../../../shared/types/hpo-data'
import {
  HPO_SCORING_CONFIG,
  type HpoScoringOptions
} from '../../../shared/config/hpo-scoring.config'
import type { HpoExplanation, HpoProfileTerm } from '../../../shared/types/hpo-profile'
import {
  informationContent,
  parseGeneDiseases,
  parseHpJson,
  parseHpoaDiseases,
  phenotypeClosure,
  type HpoaFrequency
} from '../../../shared/phenotype/hpo-sources'
import { buildPhenotypeIndex, type PhenotypeIndex } from '../../../shared/phenotype/phenotype-index'
import { computeDiseaseNull } from '../../../shared/phenotype/phenotype-null'
import { nullParams } from '../../../shared/phenotype/phenotype-calibration'
import {
  diseaseScore01,
  explainDisease,
  explainGene,
  prepareProfile,
  sidak,
  scoreProfile,
  type CaseProfile,
  type CaseScores
} from '../../../shared/phenotype/phenotype-score'
import { mainLogger } from '../MainLogger'
import { writeLocusReference, type LocusSourceInput } from './locus-reference-db'
import type { DbPool } from '../../database/DbPool'

/** Desktop main sets the env var to userData at startup; workers inherit it. */
export function resolveHpoDbPath(): string | null {
  const path = process.env[HPO_DATA_CONFIG.envPath]
  return path === undefined || path.trim() === '' ? null : path
}

export interface HpoSourceTexts {
  ontology: string
  annotations: string
  genes: string
  /** optional CNV/STR sources (CNV/STR spec §3); absent: no fresh locus data */
  locus?: LocusSourceInput
}

export interface HpoBuildMeta {
  release: string
  /** asset file name → sha256 hex of the downloaded bytes */
  sha256: Record<string, string>
}

/** Builds the DB at `outPath`; returns one warning per stale or missing optional source. */
export function buildHpoSimilarityDb(
  sources: HpoSourceTexts,
  meta: HpoBuildMeta,
  outPath: string,
  /**
   * τ to build the background null for (~15 s), or null to skip it. Default: only when the
   * configured correction needs one; the benchmark builds one DB per τ arm.
   */
  nullTau: number | null = HPO_SCORING_CONFIG.backgroundCorrection === 'off'
    ? null
    : HPO_SCORING_CONFIG.tau
): string[] {
  const ontology = parseHpJson(sources.ontology)
  const ancestors = phenotypeClosure(ontology)
  const hpoa = parseHpoaDiseases(sources.annotations, ontology.aliases)
  const positive = new Map([...hpoa.terms].map(([d, map]) => [d, new Set(map.keys())]))
  const ic = informationContent(positive, ancestors)
  const genes = parseGeneDiseases(sources.genes, hpoa.terms)
  const canonical = (raw: string): string | null => {
    const term = ontology.aliases.get(raw) ?? raw
    return ancestors.has(term) ? term : null
  }
  // Indexed diseases: phenotype-subtree terms only (aliases already pooled by the parser).
  const linked = new Map<string, Map<string, HpoaFrequency>>()
  const admit = (d: string): void => {
    if (linked.has(d)) return
    const merged = new Map<string, HpoaFrequency>()
    for (const [raw, freq] of hpoa.terms.get(d) ?? []) {
      const term = canonical(raw)
      const prev = term === null ? undefined : merged.get(term)
      if (term !== null && (prev === undefined || freq.f > prev.f)) merged.set(term, freq)
    }
    if (merged.size > 0) linked.set(d, merged)
  }
  for (const diseases of genes.values()) for (const d of diseases) admit(d)
  const geneLinked = new Set(linked.keys())

  rmSync(outPath, { force: true })
  const db = new Database(outPath)
  try {
    // Region and STR diseases are indexed but never gene-linked: gene scores stay byte-identical.
    const locus = writeLocusReference(db, sources.locus)
    for (const d of locus.diseases) admit(d)
    db.exec(`
      CREATE TABLE terms (id TEXT PRIMARY KEY, label TEXT NOT NULL, ic REAL NOT NULL) WITHOUT ROWID;
      CREATE TABLE parents (term TEXT NOT NULL, parent TEXT NOT NULL, PRIMARY KEY (term, parent)) WITHOUT ROWID;
      CREATE TABLE aliases (alias TEXT PRIMARY KEY, term TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE diseases (id TEXT PRIMARY KEY, label TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE disease_terms (disease TEXT NOT NULL, term TEXT NOT NULL, f REAL NOT NULL, f_excl REAL NOT NULL, PRIMARY KEY (disease, term)) WITHOUT ROWID;
      CREATE TABLE disease_not (disease TEXT NOT NULL, term TEXT NOT NULL, PRIMARY KEY (disease, term)) WITHOUT ROWID;
      CREATE TABLE gene_diseases (gene_symbol TEXT NOT NULL, disease TEXT NOT NULL, PRIMARY KEY (gene_symbol, disease)) WITHOUT ROWID;
      CREATE TABLE disease_null (disease TEXT PRIMARY KEY, mu BLOB NOT NULL, sd BLOB NOT NULL) WITHOUT ROWID;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    `)
    const insertTerm = db.prepare('INSERT INTO terms VALUES (?, ?, ?)')
    const insertParent = db.prepare('INSERT INTO parents VALUES (?, ?)')
    const insertAlias = db.prepare('INSERT INTO aliases VALUES (?, ?)')
    const insertDisease = db.prepare('INSERT INTO diseases VALUES (?, ?)')
    const insertDiseaseTerm = db.prepare('INSERT INTO disease_terms VALUES (?, ?, ?, ?)')
    const insertNot = db.prepare('INSERT OR IGNORE INTO disease_not VALUES (?, ?)')
    const insertGene = db.prepare('INSERT INTO gene_diseases VALUES (?, ?)')
    const insertMeta = db.prepare('INSERT INTO meta VALUES (?, ?)')
    db.transaction(() => {
      for (const [id, label] of ontology.labels) insertTerm.run(id, label, ic.get(id) ?? 0)
      for (const [term, list] of ontology.parents) {
        if (!ancestors.has(term)) continue
        for (const parent of list) if (ancestors.has(parent)) insertParent.run(term, parent)
      }
      for (const [alias, term] of ontology.aliases) insertAlias.run(alias, term)
      for (const [d, terms] of linked) {
        insertDisease.run(d, hpoa.labels.get(d) ?? d)
        for (const [term, { f, fExcl }] of terms) insertDiseaseTerm.run(d, term, f, fExcl)
        for (const raw of hpoa.not.get(d) ?? []) {
          const term = canonical(raw)
          if (term !== null && !terms.has(term)) insertNot.run(d, term)
        }
      }
      for (const [gene, diseases] of genes) {
        for (const d of diseases) if (geneLinked.has(d)) insertGene.run(gene, d)
      }
      insertMeta.run('hpo_version', meta.release)
      insertMeta.run('builder_version', String(HPO_DATA_CONFIG.builderVersion))
      insertMeta.run('sources_sha256', JSON.stringify(meta.sha256))
      insertMeta.run('sources', JSON.stringify({ hpo: meta.release, ...locus.sources }))
      insertMeta.run('built_at', String(Math.floor(Date.now() / 1000)))
    })()
    if (nullTau !== null) writeDiseaseNull(db, nullTau)
    return locus.warnings
  } finally {
    db.close()
  }
}

/** Background null of S⁺ per disease (Float32 μ, σ for query sizes 1..nullMaxK), from the built tables. */
function writeDiseaseNull(db: Database.Database, tau: number): void {
  const index = readIndex(db)
  const { mu, sd } = computeDiseaseNull(index, tau)
  const K = HPO_SCORING_CONFIG.nullMaxK
  const insert = db.prepare('INSERT INTO disease_null VALUES (?, ?, ?)')
  const bytes = (a: Float32Array, d: number): Buffer =>
    Buffer.from(a.buffer, a.byteOffset + d * K * 4, K * 4)
  db.transaction(() => {
    index.diseaseIds.forEach((id, d) => insert.run(id, bytes(mu, d), bytes(sd, d)))
    db.prepare('INSERT INTO meta VALUES (?, ?)').run('null_params', nullParams(tau))
  })()
}

function openReadonly(path: string | null): Database.Database | null {
  if (path === null || !existsSync(path)) return null
  return new Database(path, { readonly: true, fileMustExist: true })
}

const NOT_INSTALLED: HpoDataStatus = {
  installed: false,
  needsUpdate: false,
  version: null,
  builtAt: null,
  termCount: 0,
  geneCount: 0
}

function inspect(db: Database.Database): HpoDataStatus {
  const meta = new Map(
    (db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>).map(
      (r) => [r.key, r.value]
    )
  )
  const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c
  const termCount = count('SELECT COUNT(*) AS c FROM terms')
  const sources = meta.get('sources')
  const status = {
    installed: true,
    version: meta.get('hpo_version') ?? null,
    builtAt: Number(meta.get('built_at') ?? 0) || null,
    termCount,
    ...(sources === undefined ? {} : { sources: JSON.parse(sources) as Record<string, string> })
  }
  // An older builder's file may lack the current tables: report it before querying them.
  if (meta.get('builder_version') !== String(HPO_DATA_CONFIG.builderVersion)) {
    return { ...status, needsUpdate: true, geneCount: 0 }
  }
  const geneCount = count('SELECT COUNT(DISTINCT gene_symbol) AS c FROM gene_diseases')
  const usable =
    geneCount > 0 &&
    count('SELECT COUNT(*) AS c FROM disease_terms') > 0 &&
    count('SELECT COUNT(*) AS c FROM terms WHERE ic > 0') > 0 &&
    count('SELECT COUNT(*) AS c FROM parents') > 0 &&
    nullMatchesConfig(meta.get('null_params'), count)
  return { ...status, needsUpdate: !usable, geneCount }
}

/** A configured background correction needs a complete null built for the configured τ. */
function nullMatchesConfig(params: string | undefined, count: (sql: string) => number): boolean {
  if (HPO_SCORING_CONFIG.backgroundCorrection === 'off') return true
  const bytes = HPO_SCORING_CONFIG.nullMaxK * 4
  return (
    params === nullParams(HPO_SCORING_CONFIG.tau) &&
    count(
      `SELECT COUNT(*) AS c FROM disease_null WHERE length(mu) = ${bytes} AND length(sd) = ${bytes}`
    ) === count('SELECT COUNT(*) AS c FROM diseases')
  )
}

/** Installed release; a damaged or wrong-schema file reads as not installed + needs update. */
export function readHpoDataStatus(path: string | null = resolveHpoDbPath()): HpoDataStatus {
  let db: Database.Database | null = null
  try {
    db = openReadonly(path)
    if (db === null) return NOT_INSTALLED
    return inspect(db)
  } catch (error) {
    mainLogger.warn(
      `HPO data at ${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      'hpo-data'
    )
    return { ...NOT_INSTALLED, needsUpdate: true }
  } finally {
    db?.close()
  }
}

/** Throws unless `path` holds a complete DB from the current builder (checked before publishing). */
export function assertUsableHpoDb(path: string): void {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    if (inspect(db).needsUpdate) throw new Error('HPO data build produced an incomplete database')
  } finally {
    db.close()
  }
}

export interface HpoGeneScorer {
  /** Disease-level phenotype score of the gene in [0, 1] (spec §3); null without gene data. */
  score(gene: string): number | null
  /** Id of the gene's best-matching disease. */
  bestDisease(gene: string): string | null
  /** Excluded case terms contradicted by the best disease (cheap: no explanation built). */
  conflicts(gene: string): number | null
  /** Lazy explanation, for displayed rows only. */
  explain(gene: string): HpoExplanation | null
  /** Max S(d) over the listed disease ids that are indexed; null if none is (CNV/STR spec §6.1). */
  scoreDiseases(ids: readonly string[]): { score: number; disease: string } | null
  /** Explanation of one disease (STR, region route); percentile against the gene distribution. */
  explainDisease(id: string): HpoExplanation | null
  /** Šidák mapping of a gene score onto the best of n genes of this case; sidak(s, 1) === s. */
  sidak(score: number, n: number): number
}

/** Disease id → index position, built once per loaded index. */
const diseaseIndexes = new WeakMap<PhenotypeIndex, ReadonlyMap<string, number>>()
function diseaseIndexOf(index: PhenotypeIndex): ReadonlyMap<string, number> {
  let map = diseaseIndexes.get(index)
  if (map === undefined) {
    map = new Map(index.diseaseIds.map((id, d) => [id, d]))
    diseaseIndexes.set(index, map)
  }
  return map
}

/** Phenotype index of one DB file, kept per process until the file changes. */
let cached: { key: string; index: PhenotypeIndex | null } | null = null
/** Last case results per (index, canonical profile): paging never rescores or re-explains. */
interface Memo {
  scores: CaseScores
  explained: Map<number, HpoExplanation>
}
const results = new Map<string, Memo>()

const rows = <T>(db: Database.Database, sql: string): T[] => db.prepare(sql).raw().all() as T[]

/**
 * One stat per call is the cache check: the file is replaced by another
 * thread (desktop update) or by an operator (web), so mtime/size is the only
 * signal every reader sees. Null key when the file is missing.
 */
const float32 = (blob: Buffer): Float32Array =>
  new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength))

function readIndex(db: Database.Database): PhenotypeIndex {
  // Terms with an entry in `parents` or the subtree root are the phenotype subtree.
  const terms = db
    .prepare('SELECT id, ic, label FROM terms WHERE id = ? OR id IN (SELECT term FROM parents)')
    .all(HPO_DATA_CONFIG.phenotypeRoot) as Array<{ id: string; ic: number; label: string }>
  return buildPhenotypeIndex({
    terms,
    edges: rows(db, 'SELECT term, parent FROM parents'),
    aliases: rows(db, 'SELECT alias, term FROM aliases'),
    diseases: rows(db, 'SELECT id, label FROM diseases'),
    diseaseTerms: rows(db, 'SELECT disease, term, f, f_excl FROM disease_terms'),
    diseaseNot: rows(db, 'SELECT disease, term FROM disease_not'),
    geneDiseases: rows(db, 'SELECT gene_symbol, disease FROM gene_diseases'),
    diseaseNull: rows<[string, Buffer, Buffer]>(db, 'SELECT disease, mu, sd FROM disease_null').map(
      ([d, mu, sd]) => [d, float32(mu), float32(sd)] as const
    ),
    nullParams: (
      db.prepare("SELECT value FROM meta WHERE key = 'null_params'").get() as
        { value: string } | undefined
    )?.value
  })
}

function loadIndex(path: string): { key: string; index: PhenotypeIndex | null } | null {
  const stat = statSync(path, { throwIfNoEntry: false })
  if (stat === undefined) return null
  const key = `${path}\0${stat.mtimeMs}\0${stat.size}`
  if (cached?.key === key) return cached
  results.clear()
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    if (inspect(db).needsUpdate) {
      mainLogger.warn(`HPO data at ${path} needs an update; hpo_resnik stays null`, 'hpo-data')
      return (cached = { key, index: null })
    }
    return (cached = { key, index: readIndex(db) })
  } finally {
    db.close()
  }
}

/** The process-cached index of `path` (null when it needs an update); throws on an unreadable file. */
export function loadPhenotypeIndex(path: string): PhenotypeIndex | null {
  return loadIndex(path)?.index ?? null
}

/**
 * Load and cache the index off the request path (after DB open, worker start
 * or an HPO install), so a later `openHpoGeneScorer` only scores. Never throws.
 */
export function prewarmHpoIndex(path: string | null = resolveHpoDbPath()): boolean {
  if (path === null || !existsSync(path)) return false
  try {
    return (loadIndex(path)?.index ?? null) !== null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainLogger.warn(`HPO similarity unavailable: ${message}`, 'hpo-data')
    return false
  }
}

/** Score the profile, or reuse one of the last few results for the same profile. */
function caseScores(
  key: string,
  index: PhenotypeIndex,
  profile: CaseProfile,
  options: Partial<HpoScoringOptions>
): Memo {
  const memoKey = `${key}\0${JSON.stringify(options)}\0${profile.hash}`
  let hit = results.get(memoKey)
  if (hit !== undefined) {
    results.delete(memoKey)
  } else {
    hit = { scores: scoreProfile(index, profile, options), explained: new Map() }
    if (results.size >= HPO_SCORING_CONFIG.memoisedCases) {
      results.delete(results.keys().next().value as string)
    }
  }
  results.set(memoKey, hit)
  return hit
}

/**
 * Prewarm in a read worker, where the desktop ranks; only with HPO data
 * installed, so opening a database without it spawns no worker.
 */
export function prewarmHpoIndexInPool(pool: Pick<DbPool, 'run'> | null): void {
  const path = resolveHpoDbPath()
  if (pool === null || path === null || !existsSync(path)) return
  pool.run({ type: 'hpo:prewarm', params: [] }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    mainLogger.warn(`HPO index prewarm in the read pool failed: ${message}`, 'hpo-data')
  })
}

/**
 * Scorer for one case's HPO profile, or null when there is no present
 * phenotype term or no usable HPO data (the ranking then has `hpo_resnik`
 * null). All genes are scored up front from the in-memory index; the DB is
 * read once per process (again only after an update replaces the file). A
 * damaged DB is logged, never thrown: rankings must not break on reference data.
 */
export function openHpoGeneScorer(
  terms: readonly HpoProfileTerm[],
  path: string | null = resolveHpoDbPath(),
  /** tuning overrides (benchmark); defaults come from HPO_SCORING_CONFIG */
  options: Partial<HpoScoringOptions> = {}
): HpoGeneScorer | null {
  if (terms.length === 0 || path === null) return null
  try {
    const loaded = loadIndex(path)
    const index = loaded?.index ?? null
    const profile = index === null ? null : prepareProfile(index, terms)
    if (loaded === null || index === null || profile === null) return null
    const { scores, explained } = caseScores(loaded.key, index, profile, options)
    const { genes } = index
    return {
      score: (symbol) => {
        const g = genes.get(symbol)
        return g === undefined ? null : scores.geneScore[g]
      },
      bestDisease: (symbol) => {
        const g = genes.get(symbol)
        return g === undefined ? null : index.diseaseIds[scores.geneBest[g]]
      },
      conflicts: (symbol) => {
        const g = genes.get(symbol)
        return g === undefined ? null : scores.geneConflicts[g]
      },
      explain(symbol) {
        const g = genes.get(symbol)
        if (g === undefined) return null
        let e = explained.get(g)
        if (e === undefined) explained.set(g, (e = explainGene(index, scores, g)))
        return e
      },
      scoreDiseases(ids) {
        const diseases = diseaseIndexOf(index)
        let best: { score: number; disease: string } | null = null
        for (const id of ids) {
          const d = diseases.get(id)
          if (d === undefined) continue
          const score = diseaseScore01(scores, d)
          if (best === null || score > best.score) best = { score, disease: id }
        }
        return best
      },
      explainDisease(id) {
        const d = diseaseIndexOf(index).get(id)
        return d === undefined ? null : explainDisease(index, scores, d)
      },
      sidak: (score, n) => sidak(scores, score, n)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainLogger.warn(`HPO similarity unavailable: ${message}`, 'hpo-data')
    return null
  }
}
