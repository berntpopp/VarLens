/**
 * Export artifacts the web server can deliver through a download grant:
 *
 *   - `variants`  one case's filtered variants    CSV or XLSX
 *   - `cohort`    filtered cohort variants        CSV or XLSX
 *   - `panel-bed` a gene panel as BED intervals   BED (gene coordinates from
 *                 the bundled gene reference DB; panel tooling is P-C's,
 *                 this module only owns delivery)
 *
 * Requests are validated with the same zod schemas the desktop IPC handlers
 * use. Tabular artifacts stream rows from the Postgres query stream; nothing
 * is buffered whole (CSV in ~64 KiB chunks, XLSX via xlsx-stream.ts).
 */
import { z } from 'zod'

import { COHORT_EXPORT_COLUMNS } from '../../../main/workers/cohort-export'
import {
  buildMetadataSheet,
  EXPORT_COLUMNS,
  type ExportColumn
} from '../../../main/workers/export-pipeline'
import { csvEscape, formatCellValue } from '../../../main/workers/export-renderer'
import { generateBedContentForSession } from '../../../main/ipc/handlers/panels-session'
import type { StorageSession } from '../../../main/storage/session'
import {
  CohortSearchParamsSchema,
  VariantExportParamsSchema
} from '../../../shared/api/schemas/export'
import { PanelExportBedSchema } from '../../../shared/types/ipc-schemas'
import type { ExportFilterSummary } from '../../../shared/types/export-worker'
import { getWebGeneReferenceService } from '../web-gene-reference'
import { xlsxStream, type XlsxCell, type XlsxStreamResult } from './xlsx-stream'

const ExportFormatSchema = z.enum(['csv', 'xlsx']).default('csv')

export const ExportArtifactRequestSchema = z.discriminatedUnion('kind', [
  VariantExportParamsSchema.extend({ kind: z.literal('variants'), format: ExportFormatSchema }),
  z.object({
    kind: z.literal('cohort'),
    format: ExportFormatSchema,
    params: CohortSearchParamsSchema
  }),
  PanelExportBedSchema.extend({ kind: z.literal('panel-bed') })
])

export type ExportArtifactRequest = z.infer<typeof ExportArtifactRequestSchema>

type Row = Record<string, unknown>

export interface OpenedArtifact {
  fileName: string
  contentType: string
  /** Audit key recorded when the artifact is streamed. */
  auditKey: string
  body: AsyncIterable<Buffer | string>
  /** Release the row source early (client abort); idempotent. */
  release: () => Promise<void>
}

export interface ArtifactProgress {
  (rows: number, done: boolean): void
}

const CHUNK_TARGET_CHARS = 64 * 1024
const CSV_TYPE = 'text/csv; charset=utf-8'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const BED_TYPE = 'text/plain; charset=utf-8'

/** Same sanitisation as the desktop save-dialog default name. */
export function exportFileStem(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_')
}

export function artifactFileName(request: ExportArtifactRequest, panelName?: string): string {
  switch (request.kind) {
    case 'variants':
      return `${exportFileStem(request.caseName)}_variants.${request.format}`
    case 'cohort':
      return `cohort_variants_${new Date().toISOString().slice(0, 10)}.${request.format}`
    case 'panel-bed':
      return `${(panelName ?? `panel_${request.panelId}`).replace(/[^a-zA-Z0-9_-]/g, '_')}_${request.assembly}.bed`
  }
}

/**
 * Pull the first row before anything is sent, so a query that fails up front
 * (bad filter, DB down) surfaces as a JSON error instead of a truncated file.
 * `release` returns the source iterator exactly once (ends the pg stream and
 * frees its pooled client).
 */
async function primedRows(source: AsyncIterable<Row>): Promise<{
  rows: AsyncIterable<Row>
  release: () => Promise<void>
}> {
  const iterator = source[Symbol.asyncIterator]()
  const first = await iterator.next()
  let released = first.done === true
  const release = async (): Promise<void> => {
    if (released) return
    released = true
    await iterator.return?.()
  }
  async function* rows(): AsyncGenerator<Row> {
    try {
      let current = first
      while (current.done !== true && !released) {
        yield current.value
        current = await iterator.next()
      }
      if (current.done === true) released = true
    } finally {
      await release()
    }
  }
  return { rows: rows(), release }
}

async function* countRows<T>(
  source: AsyncIterable<T>,
  progress: ArtifactProgress
): AsyncGenerator<T> {
  let rows = 0
  for await (const item of source) {
    rows += 1
    if (rows % 1000 === 0) progress(rows, false)
    yield item
  }
  progress(rows, true)
}

async function* csvBody(
  columns: readonly ExportColumn[],
  rows: AsyncIterable<Row>
): AsyncGenerator<string> {
  let buffer = `${columns.map((column) => csvEscape(column.header)).join(',')}\r\n`
  for await (const row of rows) {
    buffer += `${columns.map((c) => csvEscape(formatCellValue(c.key, row[c.key]))).join(',')}\r\n`
    if (buffer.length >= CHUNK_TARGET_CHARS) {
      yield buffer
      buffer = ''
    }
  }
  if (buffer !== '') yield buffer
}

async function* xlsxCells(
  columns: readonly ExportColumn[],
  rows: AsyncIterable<Row>
): AsyncGenerator<XlsxCell[]> {
  for await (const row of rows) {
    yield columns.map((c) => formatCellValue(c.key, row[c.key]) as XlsxCell)
  }
}

function filterSummary(filters: Record<string, unknown>): ExportFilterSummary {
  const pick = <K extends keyof ExportFilterSummary>(key: K): ExportFilterSummary[K] =>
    filters[key] as ExportFilterSummary[K]
  return {
    gene_symbol: pick('gene_symbol'),
    consequences: pick('consequences'),
    funcs: pick('funcs'),
    clinvars: pick('clinvars'),
    gnomad_af_max: pick('gnomad_af_max'),
    cadd_min: pick('cadd_min'),
    carrier_count_max: pick('carrier_count_max')
  }
}

async function openTabular(
  request: Extract<ExportArtifactRequest, { kind: 'variants' | 'cohort' }>,
  session: StorageSession,
  progress: ArtifactProgress
): Promise<OpenedArtifact> {
  const source = (await session
    .getReadExecutor()
    .execute(
      request.kind === 'variants'
        ? { type: 'export:variants', params: [{ ...request.filters, case_id: request.caseId }] }
        : { type: 'export:cohort', params: [request.params] }
    )) as AsyncIterable<Row>
  const { rows, release } = await primedRows(source)
  const counted = countRows(rows, progress)
  const columns = request.kind === 'variants' ? EXPORT_COLUMNS : COHORT_EXPORT_COLUMNS
  const fileName = artifactFileName(request)
  const auditKey = `export:${request.kind}`

  if (request.format === 'csv') {
    return { fileName, contentType: CSV_TYPE, auditKey, body: csvBody(columns, counted), release }
  }

  const result: XlsxStreamResult = { rowCount: 0, truncated: false }
  const info =
    request.kind === 'variants'
      ? {
          name: 'Export Info',
          rows: (r: XlsxStreamResult) => [
            ...buildMetadataSheet(request.caseName, r.rowCount, filterSummary(request.filters)),
            ...(r.truncated ? [['Truncated', 'Excel row limit reached; use CSV for all rows']] : [])
          ]
        }
      : undefined
  const body = xlsxStream(
    {
      name: request.kind === 'variants' ? 'Variants' : 'Cohort Variants',
      header: columns.map((c) => c.header),
      rows: xlsxCells(columns, counted)
    },
    result,
    info
  )
  return { fileName, contentType: XLSX_TYPE, auditKey, body, release }
}

async function openPanelBed(
  request: Extract<ExportArtifactRequest, { kind: 'panel-bed' }>,
  session: StorageSession,
  progress: ArtifactProgress
): Promise<OpenedArtifact> {
  const bed = await generateBedContentForSession(
    session,
    request.panelId,
    request.assembly,
    request.paddingBp,
    getWebGeneReferenceService()
  )
  progress(bed.geneCount, true)
  async function* body(): AsyncGenerator<string> {
    yield `${bed.lines.join('\n')}\n`
  }
  return {
    fileName: artifactFileName(request, bed.panelName),
    contentType: BED_TYPE,
    auditKey: 'panels:exportBed',
    body: body(),
    release: async () => undefined
  }
}

/** Open the artifact for streaming. Throws before any byte is produced on early failure. */
export async function openExportArtifact(
  request: ExportArtifactRequest,
  session: StorageSession,
  progress: ArtifactProgress
): Promise<OpenedArtifact> {
  return request.kind === 'panel-bed'
    ? openPanelBed(request, session, progress)
    : openTabular(request, session, progress)
}
