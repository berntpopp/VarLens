/**
 * `hpo_similarity.db`: unencrypted, read-only reference data for the in-app
 * Resnik score (#600), like gene_reference.db. Built by `buildHpoSimilarityDb`
 * from the HPO release files; read per shortlist run (open → score → close),
 * so an update's atomic rename is picked up without a reopen hook. Safe in
 * worker threads and the web server: no Electron imports.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { existsSync, rmSync } from 'fs'
import { HPO_DATA_CONFIG } from '../../../shared/config/hpo-data.config'
import type { HpoDataStatus } from '../../../shared/types/hpo-data'
import {
  informationContent,
  parseGenesToPhenotype,
  parseHpJson,
  parseHpoaDiseaseTerms,
  phenotypeClosure
} from '../../../shared/phenotype/hpo-sources'
import { symmetricBestMatchAverage } from '../../../shared/phenotype/resnik'
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
      CREATE TABLE ancestors (term TEXT NOT NULL, anc TEXT NOT NULL, PRIMARY KEY (term, anc)) WITHOUT ROWID;
      CREATE INDEX ancestors_by_anc ON ancestors (anc, term);
      CREATE TABLE aliases (alias TEXT PRIMARY KEY, term TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE gene_terms (gene_symbol TEXT NOT NULL, term TEXT NOT NULL, PRIMARY KEY (gene_symbol, term)) WITHOUT ROWID;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    `)
    const insertTerm = db.prepare('INSERT INTO terms VALUES (?, ?, ?)')
    const insertAnc = db.prepare('INSERT INTO ancestors VALUES (?, ?)')
    const insertAlias = db.prepare('INSERT INTO aliases VALUES (?, ?)')
    const insertGene = db.prepare('INSERT OR IGNORE INTO gene_terms VALUES (?, ?)')
    const insertMeta = db.prepare('INSERT INTO meta VALUES (?, ?)')
    db.transaction(() => {
      for (const [id, label] of ontology.labels) insertTerm.run(id, label, ic.get(id) ?? 0)
      for (const [term, list] of ancestors) {
        if (ontology.aliases.has(term)) continue
        for (const anc of list) insertAnc.run(term, anc)
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
    count('SELECT COUNT(*) AS c FROM ancestors') > 0
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
  close(): void
}

/**
 * The case profile resolved once: canonical, deduplicated phenotype terms and,
 * per term, Resnik sim to every term sharing an informative ancestor with it
 * (absent = 0). Genes are then scored from memory, one term read per gene.
 */
function loadScorer(db: Database.Database, patientTerms: readonly string[]): HpoGeneScorer | null {
  const aliasStmt = db.prepare('SELECT term FROM aliases WHERE alias = ?').pluck()
  const ancStmt = db.prepare(
    'SELECT anc, ic FROM ancestors JOIN terms ON terms.id = anc WHERE term = ?'
  )
  const profile = new Map<string, Map<string, number>>()
  const informative = new Map<string, number>()
  const ancestorsOf = new Map<string, string[]>()
  for (const raw of patientTerms) {
    const term = (aliasStmt.get(raw) as string | undefined) ?? raw
    if (profile.has(term)) continue
    const rows = ancStmt.all(term) as Array<{ anc: string; ic: number }>
    if (rows.length === 0) continue // unknown or outside Phenotypic abnormality
    profile.set(term, new Map())
    const own = rows.filter((r) => r.ic > 0)
    ancestorsOf.set(
      term,
      own.map((r) => r.anc)
    )
    for (const r of own) informative.set(r.anc, r.ic)
  }
  if (profile.size === 0) return null
  const below = db.prepare(
    'SELECT term, anc FROM ancestors WHERE anc IN (SELECT value FROM json_each(?))'
  )
  const reached = new Map<string, string[]>()
  for (const { term, anc } of below.all(JSON.stringify([...informative.keys()])) as Array<{
    term: string
    anc: string
  }>) {
    const list = reached.get(anc)
    if (list === undefined) reached.set(anc, [term])
    else list.push(term)
  }
  for (const [term, sims] of profile) {
    for (const anc of ancestorsOf.get(term) ?? []) {
      const ic = informative.get(anc) ?? 0
      for (const other of reached.get(anc) ?? []) {
        if (ic > (sims.get(other) ?? 0)) sims.set(other, ic)
      }
    }
  }
  const patient = [...profile.keys()]
  const geneStmt = db.prepare('SELECT term FROM gene_terms WHERE gene_symbol = ?').pluck()
  const scores = new Map<string, number | null>()
  return {
    score(gene) {
      let s = scores.get(gene)
      if (s === undefined) {
        s = symmetricBestMatchAverage(
          patient,
          geneStmt.all(gene) as string[],
          (p, g) => profile.get(p)?.get(g) ?? 0
        )
        scores.set(gene, s)
      }
      return s
    },
    close: () => db.close()
  }
}

/**
 * Scorer for one case's HPO terms, or null when there are no phenotype terms
 * or no usable HPO data (the ranking then has `hpo_resnik` null). A damaged DB
 * is logged, never thrown: rankings must not break on reference data.
 */
export function openHpoGeneScorer(
  patientTerms: readonly string[],
  path: string | null = resolveHpoDbPath()
): HpoGeneScorer | null {
  if (patientTerms.length === 0) return null
  let db: Database.Database | null = null
  try {
    db = openReadonly(path)
    const scorer = db === null ? null : loadScorer(db, patientTerms)
    if (scorer === null) db?.close()
    return scorer
  } catch (error) {
    db?.close()
    mainLogger.warn(
      `HPO similarity unavailable: ${error instanceof Error ? error.message : String(error)}`,
      'hpo-data'
    )
    return null
  }
}
