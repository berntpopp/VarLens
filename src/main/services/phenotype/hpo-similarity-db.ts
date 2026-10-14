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
import { HPO_SCORING_CONFIG } from '../../../shared/config/hpo-scoring.config'
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
import {
  explainGene,
  prepareProfile,
  scoreProfile,
  type CaseProfile,
  type CaseScores
} from '../../../shared/phenotype/phenotype-score'
import { mainLogger } from '../MainLogger'

/** Desktop main sets the env var to userData at startup; workers inherit it. */
export function resolveHpoDbPath(): string | null {
  const path = process.env[HPO_DATA_CONFIG.envPath]
  return path === undefined || path.trim() === '' ? null : path
}

export interface HpoSourceTexts {
  ontology: string
  annotations: string
  genes: string
}

export interface HpoBuildMeta {
  release: string
  /** asset file name → sha256 hex of the downloaded bytes */
  sha256: Record<string, string>
}

export function buildHpoSimilarityDb(
  sources: HpoSourceTexts,
  meta: HpoBuildMeta,
  outPath: string
): void {
  const ontology = parseHpJson(sources.ontology)
  const ancestors = phenotypeClosure(ontology)
  const hpoa = parseHpoaDiseases(sources.annotations)
  const positive = new Map([...hpoa.terms].map(([d, map]) => [d, new Set(map.keys())]))
  const ic = informationContent(positive, ancestors)
  const genes = parseGeneDiseases(sources.genes, hpoa.terms)
  const canonical = (raw: string): string | null => {
    const term = ontology.aliases.get(raw) ?? raw
    return ancestors.has(term) ? term : null
  }
  // Gene-linked diseases only; aliases merged onto the current term (higher frequency wins).
  const linked = new Map<string, Map<string, HpoaFrequency>>()
  for (const diseases of genes.values()) {
    for (const d of diseases) {
      if (linked.has(d)) continue
      const merged = new Map<string, HpoaFrequency>()
      for (const [raw, freq] of hpoa.terms.get(d) ?? []) {
        const term = canonical(raw)
        const prev = term === null ? undefined : merged.get(term)
        if (term !== null && (prev === undefined || freq.f > prev.f)) merged.set(term, freq)
      }
      if (merged.size > 0) linked.set(d, merged)
    }
  }

  rmSync(outPath, { force: true })
  const db = new Database(outPath)
  try {
    db.exec(`
      CREATE TABLE terms (id TEXT PRIMARY KEY, label TEXT NOT NULL, ic REAL NOT NULL) WITHOUT ROWID;
      CREATE TABLE parents (term TEXT NOT NULL, parent TEXT NOT NULL, PRIMARY KEY (term, parent)) WITHOUT ROWID;
      CREATE TABLE aliases (alias TEXT PRIMARY KEY, term TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE diseases (id TEXT PRIMARY KEY, label TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE disease_terms (disease TEXT NOT NULL, term TEXT NOT NULL, f REAL NOT NULL, f_excl REAL NOT NULL, PRIMARY KEY (disease, term)) WITHOUT ROWID;
      CREATE TABLE disease_not (disease TEXT NOT NULL, term TEXT NOT NULL, PRIMARY KEY (disease, term)) WITHOUT ROWID;
      CREATE TABLE gene_diseases (gene_symbol TEXT NOT NULL, disease TEXT NOT NULL, PRIMARY KEY (gene_symbol, disease)) WITHOUT ROWID;
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
        for (const d of diseases) if (linked.has(d)) insertGene.run(gene, d)
      }
      insertMeta.run('hpo_version', meta.release)
      insertMeta.run('builder_version', String(HPO_DATA_CONFIG.builderVersion))
      insertMeta.run('sources_sha256', JSON.stringify(meta.sha256))
      insertMeta.run('built_at', String(Math.floor(Date.now() / 1000)))
    })()
  } finally {
    db.close()
  }
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
  const status = {
    installed: true,
    version: meta.get('hpo_version') ?? null,
    builtAt: Number(meta.get('built_at') ?? 0) || null,
    termCount
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
    count('SELECT COUNT(*) AS c FROM parents') > 0
  return { ...status, needsUpdate: !usable, geneCount }
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
}

/** Phenotype index of one DB file, kept per process until the file changes. */
let cached: { key: string; index: PhenotypeIndex | null } | null = null
/** Last case results per (index, canonical profile): paging and re-sorting never rescore. */
const results = new Map<string, CaseScores>()

const rows = <T>(db: Database.Database, sql: string): T[] => db.prepare(sql).raw().all() as T[]

function loadIndex(path: string): { key: string; index: PhenotypeIndex | null } {
  const stat = statSync(path)
  const key = `${path}\0${stat.mtimeMs}\0${stat.size}`
  if (cached?.key === key) return cached
  results.clear()
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    if (inspect(db).needsUpdate) {
      mainLogger.warn(`HPO data at ${path} needs an update; hpo_resnik stays null`, 'hpo-data')
      return (cached = { key, index: null })
    }
    // Terms with an entry in `parents` or the subtree root are the phenotype subtree.
    const terms = db
      .prepare('SELECT id, ic, label FROM terms WHERE id = ? OR id IN (SELECT term FROM parents)')
      .all(HPO_DATA_CONFIG.phenotypeRoot) as Array<{ id: string; ic: number; label: string }>
    const index = buildPhenotypeIndex({
      terms,
      edges: rows(db, 'SELECT term, parent FROM parents'),
      aliases: rows(db, 'SELECT alias, term FROM aliases'),
      diseases: rows(db, 'SELECT id, label FROM diseases'),
      diseaseTerms: rows(db, 'SELECT disease, term, f, f_excl FROM disease_terms'),
      diseaseNot: rows(db, 'SELECT disease, term FROM disease_not'),
      geneDiseases: rows(db, 'SELECT gene_symbol, disease FROM gene_diseases')
    })
    return (cached = { key, index })
  } finally {
    db.close()
  }
}

/** The process-cached index of `path` (null when it needs an update); throws on an unreadable file. */
export function loadPhenotypeIndex(path: string): PhenotypeIndex | null {
  return loadIndex(path).index
}

/**
 * Load and cache the index off the request path (after DB open, worker start
 * or an HPO install), so a later `openHpoGeneScorer` only scores. Never throws.
 */
export function prewarmHpoIndex(path: string | null = resolveHpoDbPath()): boolean {
  if (path === null || !existsSync(path)) return false
  try {
    return loadIndex(path).index !== null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainLogger.warn(`HPO similarity unavailable: ${message}`, 'hpo-data')
    return false
  }
}

/** Score the profile, or reuse one of the last few results for the same profile. */
function caseScores(key: string, index: PhenotypeIndex, profile: CaseProfile): CaseScores {
  const memoKey = `${key}\0${profile.hash}`
  let hit = results.get(memoKey)
  if (hit !== undefined) {
    results.delete(memoKey)
  } else {
    hit = scoreProfile(index, profile)
    if (results.size >= HPO_SCORING_CONFIG.memoisedCases) {
      results.delete(results.keys().next().value as string)
    }
  }
  results.set(memoKey, hit)
  return hit
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
  path: string | null = resolveHpoDbPath()
): HpoGeneScorer | null {
  if (terms.length === 0 || path === null || !existsSync(path)) return null
  try {
    const { key, index } = loadIndex(path)
    const profile = index === null ? null : prepareProfile(index, terms)
    if (index === null || profile === null) return null
    const scores = caseScores(key, index, profile)
    const explained = new Map<number, HpoExplanation | null>()
    const gene = (symbol: string): number => {
      const g = index.hpo.genes.get(symbol)
      return g === undefined || scores.geneBest[g] < 0 ? -1 : g
    }
    return {
      score: (symbol) => (gene(symbol) < 0 ? null : scores.geneScore[gene(symbol)]),
      bestDisease: (symbol) =>
        gene(symbol) < 0 ? null : index.diseaseIds[scores.geneBest[gene(symbol)]],
      conflicts: (symbol) => (gene(symbol) < 0 ? null : scores.geneConflicts[gene(symbol)]),
      explain(symbol) {
        const g = gene(symbol)
        if (g < 0) return null
        if (!explained.has(g)) explained.set(g, explainGene(index, scores, g))
        return explained.get(g) ?? null
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainLogger.warn(`HPO similarity unavailable: ${message}`, 'hpo-data')
    return null
  }
}
