/**
 * Piscina db-worker — runs read-only queries on its own SQLite connection.
 *
 * Each worker thread opens an independent database handle so reads can
 * proceed in parallel without blocking the Electron main thread.
 *
 * Writes stay on the main thread; this worker only handles SELECT queries.
 */

import Database from 'better-sqlite3-multiple-ciphers'
import { workerData } from 'worker_threads'
import { DATABASE_CONFIG } from '../../shared/config'
import { createRepositories } from '../database/createRepositories'
import type { Repositories } from '../database/createRepositories'
import { AssociationDataBuilder } from '../database/AssociationDataBuilder'
import type { VariantFilters } from '../statistics/types'
import type { DbTask } from '../../shared/types/db-task'
import { convertBigInts } from '../utils/convertBigInts'

// ── Initialise connection from workerData ──────────────────────

const { dbPath, encryptionKey } = workerData as {
  dbPath: string
  encryptionKey?: string
}

const db = new Database(dbPath)

// CRITICAL: Encryption key must be the FIRST pragma issued
if (encryptionKey !== undefined && encryptionKey !== '') {
  const safeKey = encryptionKey.split("'").join("''")
  db.pragma(`key='${safeKey}'`)
}

// Performance PRAGMAs (WAL, read-optimised)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)
db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
db.pragma('foreign_keys = ON')
// Allow dirty reads from WAL — workers are read-only and tolerate stale data
db.pragma('read_uncommitted = ON')
// Enforce read-only: accidental writes from a new/incorrect task type fail fast
db.pragma('query_only = ON')

const repos: Repositories = createRepositories(db)

// ── Task dispatcher ────────────────────────────────────────────

export default function run(task: DbTask): unknown {
  const { type, params } = task

  try {
    switch (type) {
      // ── Variants ──────────────────────────────────────────
      case 'variants:query':
        return repos.variants.getVariants(
          params[0] as Parameters<typeof repos.variants.getVariants>[0],
          params[1] as number,
          params[2] as number,
          params[3] as Parameters<typeof repos.variants.getVariants>[3]
        )

      case 'variants:filterOptions':
        return repos.variants.getFilterOptions(params[0] as number)

      case 'variants:search':
        return repos.variants.searchVariants(
          params[0] as number,
          params[1] as string,
          params[2] as number
        )

      case 'variants:geneSymbols':
        return repos.variants.getGeneSymbols(
          params[0] as number,
          params[1] as string,
          params[2] as number
        )

      // ── Cohort ────────────────────────────────────────────
      case 'cohort:variants':
        return repos.cohort.getCohortVariants(
          params[0] as Parameters<typeof repos.cohort.getCohortVariants>[0]
        )

      case 'cohort:columnMeta':
        return repos.cohort.getColumnMeta()

      case 'cohort:summary':
        return repos.cohort.getCohortSummary()

      case 'cohort:carriers':
        return repos.cohort.getCarriers(
          params[0] as string,
          params[1] as number,
          params[2] as string,
          params[3] as string
        )

      case 'cohort:geneBurden':
        return repos.cohort.getGeneBurden()

      case 'cohort:summaryStatus':
        return repos.cohortSummary.getStatus()

      // ── Cases ─────────────────────────────────────────────
      case 'cases:list':
        return repos.cases.getAllCases()

      case 'cases:query':
        return repos.cases.queryCases(params[0] as Parameters<typeof repos.cases.queryCases>[0])

      // ── Annotations ───────────────────────────────────────
      case 'annotations:getGlobal':
        return repos.annotations.getGlobalAnnotation(
          params[0] as string,
          params[1] as number,
          params[2] as string,
          params[3] as string
        )

      case 'annotations:getPerCase':
        return repos.annotations.getPerCaseAnnotation(params[0] as number, params[1] as number)

      case 'annotations:getForVariant':
        return repos.annotations.getAnnotationsForVariant(
          params[0] as number,
          params[1] as string,
          params[2] as number,
          params[3] as string,
          params[4] as string
        )

      case 'annotations:batchGet':
        return repos.annotations.getBatch(
          params[0] as number | null,
          params[1] as Array<{ chr: string; pos: number; ref: string; alt: string }>
        )

      // ── Case Metadata ────────────────────────────────────
      case 'case-metadata:get':
        return repos.metadata.getCaseMetadata(params[0] as number)

      case 'case-metadata:listCohorts':
        return repos.metadata.listCohortGroups()

      case 'case-metadata:getCohortByName':
        return repos.metadata.getCohortGroupByName(params[0] as string)

      case 'case-metadata:getCaseCohorts':
        return repos.metadata.getCaseCohorts(params[0] as number)

      case 'case-metadata:getHpoTerms':
        return repos.metadata.getCaseHpoTerms(params[0] as number)

      case 'case-metadata:getDataInfo':
        return repos.metadata.getCaseDataInfo(params[0] as number)

      case 'case-metadata:listExternalIds':
        return repos.metadata.listCaseExternalIds(params[0] as number)

      case 'case-metadata:distinctPlatforms':
        return repos.metadata.getDistinctPlatforms()

      case 'case-metadata:distinctExternalIdTypes':
        return repos.metadata.getDistinctExternalIdTypes()

      case 'case-metadata:distinctHpoTerms':
        return repos.metadata.getDistinctHpoTerms()

      case 'case-metadata:getFullMetadata':
        return repos.metadata.getFullCaseMetadata(params[0] as number)

      // ── Association analysis ─────────────────────────────
      case 'association:build': {
        const builder = new AssociationDataBuilder(db)
        return builder.build(
          params[0] as number[],
          params[1] as number[],
          params[2] as VariantFilters,
          params[3] as string[]
        )
      }

      // ── Tags ──────────────────────────────────────────────
      case 'tags:list':
        return repos.tags.listTags()

      case 'tags:getVariantTags':
        return repos.tags.getVariantTags(
          params[0] as number, // caseId
          params[1] as number // variantId
        )

      case 'tags:getUsageCount':
        return repos.tags.getTagUsageCount(params[0] as number) // tagId

      // ── Transcripts ───────────────────────────────────────
      case 'transcripts:list':
        return repos.transcripts.getVariantTranscripts(params[0] as number) // variantId

      // ── Gene Lists ────────────────────────────────────────
      case 'gene-lists:list':
        return repos.geneLists.listGeneLists()

      case 'gene-lists:getGenes':
        return repos.geneLists.getGeneListGenes(params[0] as number) // geneListId

      // ── Region Files ──────────────────────────────────────
      case 'region-files:list':
        return repos.geneLists.listRegionFiles()

      // ── Database ──────────────────────────────────────────
      case 'database:overview': {
        const overview = repos.overview.getDatabaseOverview()
        return convertBigInts(overview)
      }

      default:
        throw new Error(`Unknown db-worker task type: ${type}`)
    }
  } catch (error) {
    // Convert any custom error classes to plain Error for structured clone transfer
    if (error instanceof Error) {
      const plain = new Error(error.message)
      plain.stack = error.stack
      throw plain
    }
    throw error
  }
}
