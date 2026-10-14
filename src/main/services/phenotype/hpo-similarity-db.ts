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
  ancestorClosure,
  informationContent,
  parseGenesToPhenotype,
  parseHpJson,
  parseHpoaDiseaseTerms
} from '../../../shared/phenotype/hpo-sources'
import { resnikBestMatchAverage, type HpoOntology } from '../../../shared/phenotype/resnik'

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
  const ancestors = ancestorClosure(ontology)
  const ic = informationContent(parseHpoaDiseaseTerms(sources.annotations), ancestors)
  const genes = parseGenesToPhenotype(sources.genes)

  rmSync(outPath, { force: true })
  const db = new Database(outPath)
  try {
    db.exec(`
      CREATE TABLE terms (id TEXT PRIMARY KEY, label TEXT NOT NULL, ic REAL NOT NULL) WITHOUT ROWID;
      CREATE TABLE ancestors (term TEXT NOT NULL, anc TEXT NOT NULL, PRIMARY KEY (term, anc)) WITHOUT ROWID;
      CREATE TABLE gene_terms (gene_symbol TEXT NOT NULL, term TEXT NOT NULL, PRIMARY KEY (gene_symbol, term)) WITHOUT ROWID;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    `)
    const insertTerm = db.prepare('INSERT INTO terms VALUES (?, ?, ?)')
    const insertAnc = db.prepare('INSERT INTO ancestors VALUES (?, ?)')
    const insertGene = db.prepare('INSERT INTO gene_terms VALUES (?, ?)')
    const insertMeta = db.prepare('INSERT INTO meta VALUES (?, ?)')
    db.transaction(() => {
      for (const [id, label] of ontology.labels) insertTerm.run(id, label, ic.get(id) ?? 0)
      for (const [term, list] of ancestors) for (const anc of list) insertAnc.run(term, anc)
      for (const [gene, terms] of genes) for (const term of terms) insertGene.run(gene, term)
      insertMeta.run('hpo_version', meta.release)
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
  version: null,
  builtAt: null,
  termCount: 0,
  geneCount: 0
}

export function readHpoDataStatus(path: string | null = resolveHpoDbPath()): HpoDataStatus {
  const db = openReadonly(path)
  if (db === null) return NOT_INSTALLED
  try {
    const meta = new Map(
      (
        db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>
      ).map((r) => [r.key, r.value])
    )
    const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c
    return {
      installed: true,
      version: meta.get('hpo_version') ?? null,
      builtAt: Number(meta.get('built_at') ?? 0) || null,
      termCount: count('SELECT COUNT(*) AS c FROM terms'),
      geneCount: count('SELECT COUNT(DISTINCT gene_symbol) AS c FROM gene_terms')
    }
  } finally {
    db.close()
  }
}

export interface HpoGeneScorer {
  /** Resnik BMA of the case's terms vs the gene; null without gene data. */
  score(gene: string): number | null
  close(): void
}

/**
 * Scorer for one case's HPO terms, or null when there are no terms or no
 * installed HPO data (the ranking then has `hpo_resnik` null, never an error).
 */
export function openHpoGeneScorer(
  patientTerms: readonly string[],
  path: string | null = resolveHpoDbPath()
): HpoGeneScorer | null {
  if (patientTerms.length === 0) return null
  const db = openReadonly(path)
  if (db === null) return null
  const ancStmt = db.prepare(
    'SELECT anc, ic FROM ancestors JOIN terms ON terms.id = anc WHERE term = ?'
  )
  const geneStmt = db.prepare('SELECT term FROM gene_terms WHERE gene_symbol = ?').pluck()
  const ancestorCache = new Map<string, string[] | undefined>()
  const icCache = new Map<string, number>()
  const ontology: HpoOntology = {
    ancestors(term) {
      if (!ancestorCache.has(term)) {
        const rows = ancStmt.all(term) as Array<{ anc: string; ic: number }>
        for (const r of rows) icCache.set(r.anc, r.ic)
        ancestorCache.set(term, rows.length === 0 ? undefined : rows.map((r) => r.anc))
      }
      return ancestorCache.get(term)
    },
    ic: (term) => icCache.get(term) ?? 0
  }
  const scores = new Map<string, number | null>()
  return {
    score(gene) {
      let s = scores.get(gene)
      if (s === undefined) {
        s = resnikBestMatchAverage(patientTerms, geneStmt.all(gene) as string[], ontology)
        scores.set(gene, s)
      }
      return s
    },
    close: () => db.close()
  }
}
