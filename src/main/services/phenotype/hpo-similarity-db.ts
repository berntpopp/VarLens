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
  informationContent,
  parseGenesToPhenotype,
  parseHpJson,
  parseHpoaDiseaseTerms,
  phenotypeClosure
} from '../../../shared/phenotype/hpo-sources'
import { buildHpoIndex, scoreAllGenes, type HpoIndex } from '../../../shared/phenotype/resnik'
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
  const diseases = parseHpoaDiseaseTerms(sources.annotations)
  const ic = informationContent(diseases, ancestors)
  const genes = parseGenesToPhenotype(sources.genes, diseases)

  rmSync(outPath, { force: true })
  const db = new Database(outPath)
  try {
    db.exec(`
      CREATE TABLE terms (id TEXT PRIMARY KEY, label TEXT NOT NULL, ic REAL NOT NULL) WITHOUT ROWID;
      CREATE TABLE parents (term TEXT NOT NULL, parent TEXT NOT NULL, PRIMARY KEY (term, parent)) WITHOUT ROWID;
      CREATE TABLE aliases (alias TEXT PRIMARY KEY, term TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE gene_terms (gene_symbol TEXT NOT NULL, term TEXT NOT NULL, PRIMARY KEY (gene_symbol, term)) WITHOUT ROWID;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    `)
    const insertTerm = db.prepare('INSERT INTO terms VALUES (?, ?, ?)')
    const insertParent = db.prepare('INSERT INTO parents VALUES (?, ?)')
    const insertAlias = db.prepare('INSERT INTO aliases VALUES (?, ?)')
    const insertGene = db.prepare('INSERT OR IGNORE INTO gene_terms VALUES (?, ?)')
    const insertMeta = db.prepare('INSERT INTO meta VALUES (?, ?)')
    db.transaction(() => {
      for (const [id, label] of ontology.labels) insertTerm.run(id, label, ic.get(id) ?? 0)
      for (const [term, list] of ontology.parents) {
        if (!ancestors.has(term)) continue
        for (const parent of list) if (ancestors.has(parent)) insertParent.run(term, parent)
      }
      for (const [alias, term] of ontology.aliases) insertAlias.run(alias, term)
      for (const [gene, terms] of genes) {
        for (const raw of terms) {
          const term = ontology.aliases.get(raw) ?? raw
          if (ancestors.has(term)) insertGene.run(gene, term)
        }
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
  const geneCount = count('SELECT COUNT(DISTINCT gene_symbol) AS c FROM gene_terms')
  const current = meta.get('builder_version') === String(HPO_DATA_CONFIG.builderVersion)
  const usable =
    current &&
    geneCount > 0 &&
    count('SELECT COUNT(*) AS c FROM terms WHERE ic > 0') > 0 &&
    count('SELECT COUNT(*) AS c FROM parents') > 0
  return {
    installed: true,
    needsUpdate: !usable,
    version: meta.get('hpo_version') ?? null,
    builtAt: Number(meta.get('built_at') ?? 0) || null,
    termCount,
    geneCount
  }
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
  /** Symmetric Resnik BMA of the case's terms vs the gene; null without gene data. */
  score(gene: string): number | null
}

/** Phenotype-subtree index of one DB file, kept per process until the file changes. */
let cached: { key: string; index: HpoIndex | null } | null = null

function loadIndex(path: string): HpoIndex | null {
  const stat = statSync(path)
  const key = `${path}\0${stat.mtimeMs}\0${stat.size}`
  if (cached?.key === key) return cached.index
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    if (inspect(db).needsUpdate) {
      mainLogger.warn(`HPO data at ${path} needs an update; hpo_resnik stays null`, 'hpo-data')
      cached = { key, index: null }
      return null
    }
    // Terms with an entry in `parents` or the subtree root are the phenotype subtree.
    const index = buildHpoIndex({
      terms: db
        .prepare(`SELECT id, ic FROM terms WHERE id = ? OR id IN (SELECT term FROM parents)`)
        .all(HPO_DATA_CONFIG.phenotypeRoot) as Array<{ id: string; ic: number }>,
      edges: db.prepare('SELECT term, parent FROM parents').raw().all() as Array<[string, string]>,
      aliases: db.prepare('SELECT alias, term FROM aliases').raw().all() as Array<[string, string]>,
      geneTerms: db.prepare('SELECT gene_symbol, term FROM gene_terms').raw().all() as Array<
        [string, string]
      >
    })
    cached = { key, index }
    return index
  } finally {
    db.close()
  }
}

/**
 * Scorer for one case's HPO terms, or null when there are no phenotype terms
 * or no usable HPO data (the ranking then has `hpo_resnik` null). All genes are
 * scored up front from the in-memory index; the DB is read once per process
 * (again only after an update replaces the file). A damaged DB is logged,
 * never thrown: rankings must not break on reference data.
 */
export function openHpoGeneScorer(
  patientTerms: readonly string[],
  path: string | null = resolveHpoDbPath()
): HpoGeneScorer | null {
  if (patientTerms.length === 0 || path === null || !existsSync(path)) return null
  try {
    const index = loadIndex(path)
    const scores = index === null ? null : scoreAllGenes(index, patientTerms)
    if (index === null || scores === null) return null
    return {
      score(gene) {
        const g = index.genes.get(gene)
        return g === undefined ? null : scores[g]
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainLogger.warn(`HPO similarity unavailable: ${message}`, 'hpo-data')
    return null
  }
}
