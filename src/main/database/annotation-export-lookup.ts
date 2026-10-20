/**
 * SQLite: the annotation cells of exported rows (#574; PG twin
 * storage/postgres/postgres-annotation-export.ts). Batch lookups per chunk,
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

const CHUNK_SIZE = 200

export function createCaseAnnotationBatchLookup<T extends CaseLookupRow = CaseLookupRow>(
  db: DatabaseType,
  caseId?: number | string
): (rows: readonly T[]) => Map<unknown, ReturnType<typeof caseExportCells>> {
  let cachedCaseId: number | string | undefined = caseId
  let cachedGenomeBuild: string | null = null

  const getBuild = (cid: number | string): string | null => {
    if (cachedCaseId === cid && cachedGenomeBuild !== null) {
      return cachedGenomeBuild
    }
    cachedCaseId = cid
    const buildRow = db.prepare('SELECT genome_build FROM cases WHERE id = ?').get(cid) as
      { genome_build: string } | undefined
    cachedGenomeBuild = buildRow?.genome_build ?? null
    return cachedGenomeBuild
  }

  if (caseId !== undefined) {
    getBuild(caseId)
  }

  return (rows: readonly CaseLookupRow[]) => {
    const result = new Map<unknown, ReturnType<typeof caseExportCells>>()
    if (rows.length === 0) return result

    const cid = (rows[0].case_id as number | string | undefined) ?? cachedCaseId
    const currentBuild = cid !== undefined ? getBuild(cid) : null

    const ownMap = new Map<unknown, ExportedAnnotation>()
    if (cid !== undefined) {
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE)
        const variantIds = chunk.map((r) => r.id).filter((id) => id !== undefined && id !== null)
        if (variantIds.length > 0) {
          const placeholders = variantIds.map(() => '?').join(', ')
          const annRows = db
            .prepare(
              `SELECT variant_id, acmg_classification, acmg_evidence, per_case_comment AS comment
               FROM case_variant_annotations
               WHERE case_id = ? AND variant_id IN (${placeholders})`
            )
            .all(cid, ...variantIds) as Array<ExportedAnnotation & { variant_id: unknown }>

          for (const r of annRows) {
            ownMap.set(r.variant_id, {
              acmg_classification: r.acmg_classification,
              acmg_evidence: r.acmg_evidence,
              comment: r.comment
            })
          }
        }
      }
    }

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
      const own = ownMap.get(row.id) ?? null
      const shared = globalMap.get(`${row.chr}:${row.pos}:${row.ref}:${row.alt}`) ?? null
      result.set(row.id, caseExportCells(own, shared))
    }

    return result
  }
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
