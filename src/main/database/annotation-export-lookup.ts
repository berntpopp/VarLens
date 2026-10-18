/**
 * SQLite: the annotation cells of exported rows (#574; PG twin
 * storage/postgres/postgres-annotation-export.ts). Indexed lookups per row,
 * inside the export worker's read-only connection.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

import {
  caseExportCells,
  cohortExportCells,
  type ExportedAnnotation
} from '../../shared/acmg/annotation-export'

export interface CaseLookupRow {
  id?: unknown
  case_id?: unknown
  chr?: unknown
  pos?: unknown
  ref?: unknown
  alt?: unknown
}

export interface CohortLookupRow {
  id?: unknown
  chr: string
  pos: number
  ref: string
  alt: string
  genome_build: string
}

/** The global row of a coordinate; the build expression completes it. */
const GLOBAL_AT = `SELECT acmg_classification, acmg_evidence, global_comment AS comment
  FROM variant_annotations
  WHERE chr = ? AND pos = ? AND ref = ? AND alt = ? AND genome_build =`

/** Case export: the case's own call and comment, and the global comment of its build. */
export function caseRowAnnotations(
  db: DatabaseType,
  caseId?: number | string
): (row: CaseLookupRow) => ReturnType<typeof caseExportCells> {
  let cachedCaseId: number | string | undefined = caseId
  let genomeBuild: string | null = null
  let ownMap: Map<unknown, ExportedAnnotation> | null = null

  const getOwnAndBuild = (cid: number | string) => {
    if (ownMap !== null && cachedCaseId === cid) {
      return { ownMap, genomeBuild }
    }
    cachedCaseId = cid
    const buildRow = db.prepare('SELECT genome_build FROM cases WHERE id = ?').get(cid) as
      | { genome_build: string }
      | undefined
    genomeBuild = buildRow?.genome_build ?? null

    const annRows = db
      .prepare(
        `SELECT variant_id, acmg_classification, acmg_evidence, per_case_comment AS comment
         FROM case_variant_annotations WHERE case_id = ?`
      )
      .all(cid) as Array<ExportedAnnotation & { variant_id: unknown }>
    ownMap = new Map()
    for (const r of annRows) {
      ownMap.set(r.variant_id, {
        acmg_classification: r.acmg_classification,
        acmg_evidence: r.acmg_evidence,
        comment: r.comment
      })
    }
    return { ownMap, genomeBuild }
  }

  if (caseId !== undefined) {
    getOwnAndBuild(caseId)
  }

  const global = db.prepare(
    `SELECT acmg_classification, acmg_evidence, global_comment AS comment
     FROM variant_annotations
     WHERE chr = ? AND pos = ? AND ref = ? AND alt = ? AND genome_build = ?`
  )

  return (row) => {
    const cid = (row.case_id as number | string | undefined) ?? cachedCaseId
    const { ownMap: currentOwnMap, genomeBuild: currentBuild } =
      cid !== undefined ? getOwnAndBuild(cid) : { ownMap: new Map(), genomeBuild: null }

    const own = currentOwnMap.get(row.id) ?? null
    const shared =
      currentBuild !== null && currentBuild !== ''
        ? ((global.get(row.chr, row.pos, row.ref, row.alt, currentBuild) as
            | ExportedAnnotation
            | undefined) ?? null)
        : null
    return caseExportCells(own, shared)
  }
}

const CHUNK_SIZE = 200

export function createCaseAnnotationBatchLookup<T extends CaseLookupRow = CaseLookupRow>(
  db: DatabaseType,
  caseId?: number | string
): (rows: readonly T[]) => Map<unknown, ReturnType<typeof caseExportCells>> {
  let cachedCaseId: number | string | undefined = caseId
  let genomeBuild: string | null = null
  let ownMap: Map<unknown, ExportedAnnotation> | null = null

  const getOwnAndBuild = (cid: number | string) => {
    if (ownMap !== null && cachedCaseId === cid) {
      return { ownMap, genomeBuild }
    }
    cachedCaseId = cid
    const buildRow = db.prepare('SELECT genome_build FROM cases WHERE id = ?').get(cid) as
      | { genome_build: string }
      | undefined
    genomeBuild = buildRow?.genome_build ?? null

    const annRows = db
      .prepare(
        `SELECT variant_id, acmg_classification, acmg_evidence, per_case_comment AS comment
         FROM case_variant_annotations WHERE case_id = ?`
      )
      .all(cid) as Array<ExportedAnnotation & { variant_id: unknown }>
    ownMap = new Map()
    for (const r of annRows) {
      ownMap.set(r.variant_id, {
        acmg_classification: r.acmg_classification,
        acmg_evidence: r.acmg_evidence,
        comment: r.comment
      })
    }
    return { ownMap, genomeBuild }
  }

  if (caseId !== undefined) {
    getOwnAndBuild(caseId)
  }

  return (rows: readonly CaseLookupRow[]) => {
    const result = new Map<unknown, ReturnType<typeof caseExportCells>>()
    if (rows.length === 0) return result

    const cid = (rows[0].case_id as number | string | undefined) ?? cachedCaseId
    const { ownMap: currentOwnMap, genomeBuild: currentBuild } =
      cid !== undefined ? getOwnAndBuild(cid) : { ownMap: new Map(), genomeBuild: null }

    const globalMap = new Map<string, ExportedAnnotation>()
    if (currentBuild !== null && currentBuild !== '') {
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE)
        const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ')
        const params: unknown[] = [currentBuild]
        for (const r of chunk) {
          params.push(r.chr, r.pos, r.ref, r.alt)
        }
        const globalRows = db
          .prepare(
            `SELECT chr, pos, ref, alt, acmg_classification, acmg_evidence, global_comment AS comment
             FROM variant_annotations
             WHERE genome_build = ? AND (chr, pos, ref, alt) IN (${placeholders})`
          )
          .all(...params) as Array<
            ExportedAnnotation & { chr: string; pos: number; ref: string; alt: string }
          >

        for (const g of globalRows) {
          globalMap.set(`${g.chr}:${g.pos}:${g.ref}:${g.alt}`, {
            acmg_classification: g.acmg_classification,
            acmg_evidence: g.acmg_evidence,
            comment: g.comment
          })
        }
      }
    }

    for (const row of rows) {
      const own = currentOwnMap.get(row.id) ?? null
      const shared = globalMap.get(`${row.chr}:${row.pos}:${row.ref}:${row.alt}`) ?? null
      result.set(row.id, caseExportCells(own, shared))
    }

    return result
  }
}

/** Cohort export: the global call and comment of the row's build. */
export function cohortRowAnnotations(
  db: DatabaseType
): (row: {
  chr: string
  pos: number
  ref: string
  alt: string
  genome_build: string
}) => ReturnType<typeof cohortExportCells> {
  const global = db.prepare(`${GLOBAL_AT} ?`)
  return (row) =>
    cohortExportCells(
      (global.get(row.chr, row.pos, row.ref, row.alt, row.genome_build) as
        ExportedAnnotation | undefined) ?? null
    )
}

export function createCohortAnnotationBatchLookup<T extends CohortLookupRow = CohortLookupRow>(
  db: DatabaseType
): (rows: readonly T[]) => Map<unknown, ReturnType<typeof cohortExportCells>> {
  return (rows: readonly T[]) => {
    const result = new Map<unknown, ReturnType<typeof cohortExportCells>>()
    if (rows.length === 0) return result

    const globalMap = new Map<string, ExportedAnnotation>()
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE)
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')
      const params: unknown[] = []
      for (const r of chunk) {
        params.push(r.chr, r.pos, r.ref, r.alt, r.genome_build)
      }
      const globalRows = db
        .prepare(
          `SELECT chr, pos, ref, alt, genome_build, acmg_classification, acmg_evidence, global_comment AS comment
           FROM variant_annotations
           WHERE (chr, pos, ref, alt, genome_build) IN (${placeholders})`
        )
        .all(...params) as Array<
          ExportedAnnotation & {
            chr: string
            pos: number
            ref: string
            alt: string
            genome_build: string
          }
        >

      for (const g of globalRows) {
        globalMap.set(`${g.chr}:${g.pos}:${g.ref}:${g.alt}:${g.genome_build}`, {
          acmg_classification: g.acmg_classification,
          acmg_evidence: g.acmg_evidence,
          comment: g.comment
        })
      }
    }

    for (const row of rows) {
      const shared =
        globalMap.get(`${row.chr}:${row.pos}:${row.ref}:${row.alt}:${row.genome_build}`) ?? null
      const key = row.id ?? `${row.chr}:${row.pos}:${row.ref}:${row.alt}:${row.genome_build}`
      result.set(key, cohortExportCells(shared))
    }

    return result
  }
}
