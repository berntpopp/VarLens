/**
 * CNV/STR locus reference tables in `hpo_similarity.db` (CNV/STR spec §3):
 * ClinGen dosage genes and regions, STRchive loci and the Mondo crosswalk the
 * build needs. Each optional source is written fresh when its download parses,
 * else copied with its version from the installed DB (per-source update policy),
 * else left empty. No Electron imports: runs in the build worker and the web server.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { existsSync, statSync } from 'fs'
import { HPO_DATA_CONFIG } from '../../../shared/config/hpo-data.config'
import { HPO_LOCUS_SCORING_CONFIG } from '../../../shared/config/hpo-locus-scoring.config'
import type {
  DosageGene,
  DosageRegion,
  DosageScore,
  LocusReference,
  StrLocus
} from '../../../shared/types/locus-reference'
import {
  parseClingenGenes,
  parseClingenRegions,
  parseMondoXrefs,
  parseStrchiveLoci
} from '../../../shared/phenotype/reference-sources'
import { applyStrOverride, STR_OVERRIDES } from '../../../shared/str/str-overrides'

export type LocusSourceKey = 'clingen' | 'strchive' | 'mondo'

/** Downloaded texts of the optional sources; an absent source failed its download (`errors`). */
export interface LocusSourceInput {
  clingen?: { genes: string; regions: Record<string, string> }
  strchive?: string
  mondo?: string
  /** version of each downloaded source */
  versions: Partial<Record<LocusSourceKey, string>>
  /** why a source was not downloaded */
  errors: Partial<Record<LocusSourceKey, string>>
  /** NCBI Gene id → HGNC id (gene_reference.db), to key ClinGen genes by HGNC id */
  entrezToHgnc: ReadonlyMap<string, string>
  /** installed DB whose copy a failed source keeps */
  previousPath: string | null
}

export interface LocusWriteResult {
  /** version per optional source that has data */
  sources: Partial<Record<LocusSourceKey, string>>
  /** one line per source that is stale or missing */
  warnings: string[]
  /** region and STR disease ids to admit into `diseases` (never into `gene_diseases`) */
  diseases: Set<string>
}

const LABELS: Record<LocusSourceKey, string> = {
  clingen: 'ClinGen',
  strchive: 'STRchive',
  mondo: 'Mondo'
}
const TABLES: Record<LocusSourceKey, string[]> = {
  clingen: ['dosage_genes', 'dosage_regions'],
  strchive: ['str_loci'],
  mondo: ['mondo_xrefs']
}

const LOCUS_SCHEMA = `
  CREATE TABLE dosage_genes (hgnc_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, hi INTEGER, ts INTEGER) WITHOUT ROWID;
  CREATE TABLE dosage_regions (isca_id TEXT NOT NULL, build TEXT NOT NULL, chr TEXT NOT NULL, start INTEGER NOT NULL, "end" INTEGER NOT NULL, label TEXT NOT NULL, hi INTEGER, ts INTEGER, loss_diseases TEXT NOT NULL, gain_diseases TEXT NOT NULL, PRIMARY KEY (isca_id, build)) WITHOUT ROWID;
  CREATE TABLE str_loci (id TEXT PRIMARY KEY, json TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE mondo_xrefs (mondo TEXT PRIMARY KEY, ids TEXT NOT NULL) WITHOUT ROWID;
`

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
const hasTable = (db: Database.Database, name: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
  undefined

/** The installed DB's rows and version of one source, or null when it has none. */
function previousCopy(
  path: string | null,
  key: LocusSourceKey
): { version: string; rows: Map<string, unknown[][]> } | null {
  if (path === null || !existsSync(path)) return null
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true })
    try {
      if (!TABLES[key].every((t) => hasTable(db, t))) return null
      const meta = db.prepare("SELECT value FROM meta WHERE key = 'sources'").get() as
        { value: string } | undefined
      const version = (JSON.parse(meta?.value ?? '{}') as Record<string, string>)[key]
      if (version === undefined) return null
      const rows = new Map(
        TABLES[key].map((t) => [t, db.prepare(`SELECT * FROM ${t}`).raw().all() as unknown[][]])
      )
      return { version, rows }
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

function insertRows(db: Database.Database, table: string, rows: unknown[][]): void {
  if (rows.length === 0) return
  const insert = db.prepare(
    `INSERT OR REPLACE INTO ${table} VALUES (${rows[0].map(() => '?').join(', ')})`
  )
  for (const row of rows) insert.run(...row)
}

/** Fresh rows per table of each source that parsed; a parse failure lands in `errors`. */
function parseSources(
  input: LocusSourceInput | undefined,
  errors: Partial<Record<LocusSourceKey, string>>
): Partial<Record<LocusSourceKey, Map<string, unknown[][]>>> {
  const fresh: Partial<Record<LocusSourceKey, Map<string, unknown[][]>>> = {}
  if (input === undefined) return fresh
  const cfg = HPO_DATA_CONFIG.locusSources.clingen
  let genes: DosageGene[] = []
  let regions: DosageRegion[] = []
  let loci: ReturnType<typeof parseStrchiveLoci> = []
  try {
    if (input.clingen === undefined) throw new Error(errors.clingen ?? 'not downloaded')
    if (input.entrezToHgnc.size === 0) throw new Error('gene reference unavailable')
    genes = parseClingenGenes(input.clingen.genes, input.entrezToHgnc, cfg.minGenes)
    regions = Object.entries(input.clingen.regions).flatMap(([build, text]) =>
      parseClingenRegions(text, build, cfg.minRegions)
    )
  } catch (error) {
    errors.clingen = errorText(error)
  }
  try {
    if (input.strchive === undefined) throw new Error(errors.strchive ?? 'not downloaded')
    loci = parseStrchiveLoci(input.strchive)
    const unknown = Object.keys(STR_OVERRIDES).filter((id) => !loci.some((l) => l.id === id))
    if (unknown.length > 0) throw new Error(`overrides name unknown loci: ${unknown.join(', ')}`)
  } catch (error) {
    errors.strchive = errorText(error)
  }

  // Mondo maps the MONDO ids of fresh regions and of loci without OMIM/Orphanet ids.
  const wanted = new Set<string>()
  if (errors.clingen === undefined) {
    for (const r of regions) for (const id of [...r.lossDiseases, ...r.gainDiseases]) wanted.add(id)
  }
  if (errors.strchive === undefined) {
    for (const l of loci) if (l.diseases.full.length === 0) for (const id of l.mondo) wanted.add(id)
  }
  try {
    if (input.mondo === undefined) throw new Error(errors.mondo ?? 'not downloaded')
    const xrefs = parseMondoXrefs(input.mondo, wanted)
    fresh.mondo = new Map([['mondo_xrefs', [...xrefs].map(([m, ids]) => [m, JSON.stringify(ids)])]])
  } catch (error) {
    errors.mondo = errorText(error)
  }
  // Without fresh Mondo the previous crosswalk maps the fresh sources.
  const crosswalk = new Map(
    (fresh.mondo ?? previousCopy(input.previousPath, 'mondo')?.rows)
      ?.get('mondo_xrefs')
      ?.map(([m, ids]) => [m as string, JSON.parse(ids as string) as string[]]) ?? []
  )
  const mapIds = (ids: readonly string[]): string[] => [
    ...new Set(ids.flatMap((id) => (id.startsWith('MONDO:') ? (crosswalk.get(id) ?? []) : [id])))
  ]

  if (errors.clingen === undefined) {
    fresh.clingen = new Map([
      ['dosage_genes', genes.map((g) => [g.hgncId, g.symbol, g.hi, g.ts])],
      [
        'dosage_regions',
        regions.map((r) => [
          r.iscaId,
          r.build,
          r.chr,
          r.start,
          r.end,
          r.label,
          r.hi,
          r.ts,
          JSON.stringify(mapIds(r.lossDiseases)),
          JSON.stringify(mapIds(r.gainDiseases))
        ])
      ]
    ])
  }
  if (errors.strchive === undefined) {
    const rows = loci.map(({ mondo, ...locus }) => {
      const full = locus.diseases.full.length > 0 ? locus.diseases.full : mapIds(mondo)
      const normalised: StrLocus = { ...locus, diseases: { full } }
      return [locus.id, JSON.stringify(applyStrOverride(normalised, STR_OVERRIDES[locus.id]))]
    })
    fresh.strchive = new Map([['str_loci', rows]])
  }
  return fresh
}

const SENSITIVE = (score: unknown): boolean =>
  typeof score === 'number' &&
  score >= HPO_LOCUS_SCORING_CONFIG.dosageScores.sensitiveMin &&
  score < HPO_LOCUS_SCORING_CONFIG.dosageScores.recessive

/** Disease ids of dosage-sensitive regions and of every STR locus, read back from the written tables. */
function admittedDiseases(db: Database.Database): Set<string> {
  const ids = new Set<string>()
  const regions = db
    .prepare('SELECT hi, ts, loss_diseases, gain_diseases FROM dosage_regions')
    .raw()
    .all() as Array<[number | null, number | null, string, string]>
  for (const [hi, ts, loss, gain] of regions) {
    if (SENSITIVE(hi)) for (const id of JSON.parse(loss) as string[]) ids.add(id)
    if (SENSITIVE(ts)) for (const id of JSON.parse(gain) as string[]) ids.add(id)
  }
  for (const [json] of db.prepare('SELECT json FROM str_loci').raw().all() as string[][]) {
    const { diseases } = JSON.parse(json) as StrLocus
    for (const id of [
      ...diseases.full,
      ...(diseases.premutation ?? []),
      ...(diseases.intermediate ?? [])
    ]) {
      ids.add(id)
    }
  }
  return ids
}

/**
 * Create and fill the locus tables of a DB being built. Never throws for an
 * optional source: a failure keeps the installed copy or leaves it empty.
 */
export function writeLocusReference(
  db: Database.Database,
  input: LocusSourceInput | undefined
): LocusWriteResult {
  db.exec(LOCUS_SCHEMA)
  const errors: Partial<Record<LocusSourceKey, string>> = { ...input?.errors }
  const fresh = parseSources(input, errors)
  const sources: LocusWriteResult['sources'] = {}
  const warnings: string[] = []
  db.transaction(() => {
    for (const key of Object.keys(TABLES) as LocusSourceKey[]) {
      let rows = fresh[key]
      let version = input?.versions[key]
      if (rows === undefined) {
        const previous = previousCopy(input?.previousPath ?? null, key)
        rows = previous?.rows
        version = previous?.version
        warnings.push(
          `${LABELS[key]}: ${errors[key] ?? 'not downloaded'}; ${
            version === undefined ? 'unavailable' : `kept ${version}`
          }`
        )
      }
      if (rows === undefined || version === undefined) continue
      sources[key] = version
      for (const [table, list] of rows) insertRows(db, table, list)
    }
  })()
  return { sources, warnings, diseases: admittedDiseases(db) }
}

/** Locus reference of one DB file, kept per process until the file changes. */
let cached: { key: string; value: LocusReference | null } | null = null

const score = (value: unknown): DosageScore => (value as DosageScore) ?? null

function readTables(db: Database.Database): LocusReference | null {
  if (!Object.values(TABLES).every((tables) => tables.every((t) => hasTable(db, t)))) return null
  const all = <T>(sql: string): T[] => db.prepare(sql).all() as T[]
  const dosageGenes = new Map<string, DosageGene>()
  for (const g of all<{ hgnc_id: string; symbol: string; hi: number; ts: number }>(
    'SELECT * FROM dosage_genes'
  )) {
    dosageGenes.set(g.hgnc_id, {
      hgncId: g.hgnc_id,
      symbol: g.symbol,
      hi: score(g.hi),
      ts: score(g.ts)
    })
  }
  const dosageRegions = all<Record<string, string | number | null>>(
    'SELECT * FROM dosage_regions'
  ).map((r): DosageRegion => ({
    iscaId: r.isca_id as string,
    build: r.build as string,
    chr: r.chr as string,
    start: r.start as number,
    end: r.end as number,
    label: r.label as string,
    hi: score(r.hi),
    ts: score(r.ts),
    lossDiseases: JSON.parse(r.loss_diseases as string) as string[],
    gainDiseases: JSON.parse(r.gain_diseases as string) as string[]
  }))
  const strLoci = all<{ json: string }>('SELECT json FROM str_loci').map(
    (r) => JSON.parse(r.json) as StrLocus
  )
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'sources'").get() as
    { value: string } | undefined
  const sources = JSON.parse(meta?.value ?? '{}') as Record<string, string>
  return { dosageGenes, dosageRegions, strLoci, sources }
}

/**
 * The locus reference of `path`, cached on the same mtime/size key as the
 * phenotype index; null when the file or its locus tables are absent.
 */
export function readLocusReference(path: string | null): LocusReference | null {
  const stat = path === null ? undefined : statSync(path, { throwIfNoEntry: false })
  if (path === null || stat === undefined) return null
  const key = `${path}\0${stat.mtimeMs}\0${stat.size}`
  if (cached?.key === key) return cached.value
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    return (cached = { key, value: readTables(db) }).value
  } finally {
    db.close()
  }
}
