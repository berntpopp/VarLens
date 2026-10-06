/**
 * Browser downloads for variant and cohort exports in web mode.
 *
 * The desktop export handlers write to a path chosen in a native save
 * dialog. A browser has no such path, so web mode exposes two GET
 * endpoints the SPA navigates to with an `<a download>` click:
 *
 *   GET /api/export/variants/download?caseId=<id>&caseName=<name>&filters=<json>
 *   GET /api/export/cohort/download?params=<json>
 *
 * Each streams CSV straight from the PostgreSQL query stream into the
 * HTTP response (same columns and cell formatting as the desktop
 * PostgreSQL CSV export), so nothing is buffered whole in memory or
 * written to the server's disk. A client abort destroys the response
 * stream, which returns the row iterator and releases its pooled client.
 *
 * Auth: the session preHandler in server/auth.ts already 401s anonymous
 * `/api/*` requests; this module re-checks the session, applies the
 * dispatcher's password-rotation gate, then validates params with the
 * same zod schemas the desktop IPC handlers use. Every accepted export
 * is recorded as an `api_read` audit event, like any other web read.
 */
import { Readable } from 'node:stream'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { COHORT_EXPORT_COLUMNS } from '../../../main/workers/cohort-export'
import { EXPORT_COLUMNS, type ExportColumn } from '../../../main/workers/export-pipeline'
import { csvEscape, formatCellValue } from '../../../main/workers/export-renderer'
import {
  CohortSearchParamsSchema,
  VariantExportParamsSchema
} from '../../../shared/api/schemas/export'
import { ErrorCode, type SerializableError } from '../../../shared/types/errors'
import { recordApiReadAudit } from '../audit'
import type { DispatcherDeps } from './types'

export const VARIANT_EXPORT_DOWNLOAD_PATH = '/api/export/variants/download'
export const COHORT_EXPORT_DOWNLOAD_PATH = '/api/export/cohort/download'

/** Flush to the socket in ~64 KiB chunks rather than one write per row. */
const CHUNK_TARGET_CHARS = 64 * 1024
const INVALID_JSON = Symbol('invalid-json')

type Row = Record<string, unknown>
type Query = Record<string, string | string[] | undefined>
type ExportRequest = FastifyRequest<{ Querystring: Query }>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseJsonParam(raw: string | undefined): unknown {
  if (raw === undefined || raw === '') return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return INVALID_JSON
  }
}

/** Same sanitisation as the desktop save-dialog default name. */
export function exportFileStem(caseName: string): string {
  return caseName.replace(/[^a-z0-9]/gi, '_')
}

/**
 * Returns the authenticated username, or sends 401/403 and returns
 * undefined. Mirrors the session preHandler's 401 body and the
 * dispatcher's pre-rotation gate: a session that must still change its
 * password gets no data access.
 */
function requireExportSession(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const user = request.session?.user
  if (user === undefined) {
    void reply.code(401).send({
      code: 'UNAUTHENTICATED',
      message: 'authentication required',
      userMessage: 'Please log in to continue.'
    })
    return undefined
  }
  if (request.session.mustChangePassword === true) {
    void reply.code(403).send({
      code: ErrorCode.UNKNOWN,
      message: 'password-rotation-required',
      userMessage: 'Your password must be changed before any other action.'
    } satisfies SerializableError)
    return undefined
  }
  return user.username
}

function sendInvalidParams(reply: FastifyReply, error: string, detail: string): FastifyReply {
  return reply.code(400).send({
    code: ErrorCode.INVALID_PARAMETERS,
    message: detail,
    userMessage: 'Invalid export parameters.',
    details: { error }
  } satisfies SerializableError)
}

function rowToCsvLine(columns: readonly ExportColumn[], row: Row): string {
  return columns.map((column) => csvEscape(formatCellValue(column.key, row[column.key]))).join(',')
}

async function* csvChunks(
  columns: readonly ExportColumn[],
  first: IteratorResult<Row>,
  iterator: AsyncIterator<Row>,
  onDone: (rowCount: number, completed: boolean) => Promise<void>
): AsyncGenerator<string> {
  let rowCount = 0
  let completed = false
  try {
    let buffer = `${columns.map((column) => csvEscape(column.header)).join(',')}\r\n`
    let current = first
    while (current.done !== true) {
      buffer += `${rowToCsvLine(columns, current.value)}\r\n`
      rowCount += 1
      if (buffer.length >= CHUNK_TARGET_CHARS) {
        yield buffer
        buffer = ''
      }
      current = await iterator.next()
    }
    if (buffer !== '') yield buffer
    completed = true
  } finally {
    await onDone(rowCount, completed)
  }
}

/**
 * Pulls the first row before any header is sent, so a query that fails
 * up front (bad filter, DB unavailable) still produces a JSON 500 the
 * browser reports as a failed download instead of a truncated file.
 *
 * Release contract: whenever the response ends without draining the
 * source (client abort, socket error, mid-stream query error) the source
 * iterator is returned exactly once, which ends the pg-query-stream and
 * releases its pooled client. The `close` listener covers a response torn
 * down before the generator body ever ran (a never-started generator
 * skips its `finally`).
 */
async function streamCsvDownload(params: {
  request: FastifyRequest
  reply: FastifyReply
  rows: AsyncIterable<Row>
  columns: readonly ExportColumn[]
  fileName: string
  kind: 'variants' | 'cohort'
}): Promise<FastifyReply> {
  const { request, reply, rows, columns, fileName, kind } = params
  const iterator = rows[Symbol.asyncIterator]()
  const first = await iterator.next()

  let released = first.done === true
  const releaseSource = async (): Promise<void> => {
    if (released) return
    released = true
    await iterator.return?.()
  }

  const source = Readable.from(
    csvChunks(columns, first, iterator, async (rowCount, completed) => {
      if (completed) released = true
      else await releaseSource()
      request.log.info({ event: 'web-export', kind, rowCount, completed }, 'web export finished')
    }),
    { objectMode: false }
  )
  source.once('close', () => {
    releaseSource().catch((error: unknown) => {
      request.log.warn({ event: 'web-export', kind, err: error }, 'export source release failed')
    })
  })

  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${fileName}"`)
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .send(source)
}

async function handleVariantDownload(
  request: ExportRequest,
  reply: FastifyReply,
  deps: DispatcherDeps
): Promise<FastifyReply> {
  const username = requireExportSession(request, reply)
  if (username === undefined) return reply

  const filters = parseJsonParam(firstValue(request.query.filters))
  if (filters === INVALID_JSON) {
    return sendInvalidParams(reply, 'invalid-export-variants-params', 'filters must be JSON')
  }
  const caseIdRaw = firstValue(request.query.caseId)
  const validated = VariantExportParamsSchema.safeParse({
    caseId: caseIdRaw !== undefined && /^\d+$/.test(caseIdRaw) ? Number(caseIdRaw) : caseIdRaw,
    filters,
    caseName: firstValue(request.query.caseName)
  })
  if (!validated.success) {
    return sendInvalidParams(reply, 'invalid-export-variants-params', validated.error.message)
  }

  await recordApiReadAudit(deps, { key: 'export:variants', username })
  const rows = (await deps.session.getReadExecutor().execute({
    type: 'export:variants',
    params: [{ ...validated.data.filters, case_id: validated.data.caseId }]
  })) as AsyncIterable<Row>

  return await streamCsvDownload({
    request,
    reply,
    rows,
    columns: EXPORT_COLUMNS,
    fileName: `${exportFileStem(validated.data.caseName)}_variants.csv`,
    kind: 'variants'
  })
}

async function handleCohortDownload(
  request: ExportRequest,
  reply: FastifyReply,
  deps: DispatcherDeps
): Promise<FastifyReply> {
  const username = requireExportSession(request, reply)
  if (username === undefined) return reply

  const params = parseJsonParam(firstValue(request.query.params))
  if (params === INVALID_JSON) {
    return sendInvalidParams(reply, 'invalid-export-cohort-params', 'params must be JSON')
  }
  const validated = CohortSearchParamsSchema.safeParse(params)
  if (!validated.success) {
    return sendInvalidParams(reply, 'invalid-export-cohort-params', validated.error.message)
  }

  await recordApiReadAudit(deps, { key: 'export:cohort', username })
  const rows = (await deps.session.getReadExecutor().execute({
    type: 'export:cohort',
    params: [validated.data]
  })) as AsyncIterable<Row>

  return await streamCsvDownload({
    request,
    reply,
    rows,
    columns: COHORT_EXPORT_COLUMNS,
    fileName: `cohort_variants_${new Date().toISOString().slice(0, 10)}.csv`,
    kind: 'cohort'
  })
}

export function registerExportDownloadRoutes(app: FastifyInstance, deps: DispatcherDeps): void {
  app.get<{ Querystring: Query }>(
    VARIANT_EXPORT_DOWNLOAD_PATH,
    {
      schema: {
        tags: ['export'],
        summary: 'Download a case variant export as CSV',
        description:
          'Streams the filtered variants of one case as a CSV attachment. Query: caseId, ' +
          'caseName, filters (JSON-encoded variant filter).'
      }
    },
    async (request, reply) => handleVariantDownload(request, reply, deps)
  )

  app.get<{ Querystring: Query }>(
    COHORT_EXPORT_DOWNLOAD_PATH,
    {
      schema: {
        tags: ['export'],
        summary: 'Download a cohort variant export as CSV',
        description:
          'Streams the filtered cohort variants as a CSV attachment. Query: params ' +
          '(JSON-encoded cohort search params).'
      }
    },
    async (request, reply) => handleCohortDownload(request, reply, deps)
  )
}
