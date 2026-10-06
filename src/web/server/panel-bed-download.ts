/**
 * Browser download for a gene panel as a BED file (web mode).
 *
 * Desktop `panels:exportBed` opens a save dialog and writes the file. A
 * browser has no such path, so web mode exposes
 *
 *   GET /api/panels/export-bed?panelId=<id>&assembly=<GRCh38>&paddingBp=<n>
 *
 * which the SPA opens with an `<a download>` click. The BED lines come from
 * the same `generateBedContentForSession` helper as desktop-on-Postgres, with
 * coordinates from the bundled gene reference DB. Auth mirrors the CSV export
 * download: session required, password-rotation gate, validated params, and
 * an `api_read` audit row.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { generateBedContentForSession } from '../../main/ipc/handlers/panels-session'
import { PanelExportBedSchema } from '../../shared/types/ipc-schemas'
import { ErrorCode, type SerializableError } from '../../shared/types/errors'
import { recordApiReadAudit } from './audit'
import type { DispatcherDeps } from './routes/types'
import { getWebGeneReferenceService } from './web-gene-reference'

export const PANEL_BED_DOWNLOAD_PATH = '/api/panels/export-bed'

type Query = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function numberParam(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

/** Same sanitisation as the desktop save-dialog default name. */
export function bedFileName(panelName: string, assembly: string): string {
  return `${panelName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${assembly.replace(/[^a-zA-Z0-9_.-]/g, '_')}.bed`
}

function sendError(
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  message: string,
  userMessage: string
): FastifyReply {
  return reply.code(status).send({ code, message, userMessage } satisfies SerializableError)
}

async function handleBedDownload(
  request: FastifyRequest<{ Querystring: Query }>,
  reply: FastifyReply,
  deps: DispatcherDeps
): Promise<FastifyReply> {
  const user = request.session?.user
  if (user === undefined) {
    return sendError(
      reply,
      401,
      ErrorCode.UNKNOWN,
      'authentication required',
      'Please log in to continue.'
    )
  }
  if (request.session.mustChangePassword === true) {
    return sendError(
      reply,
      403,
      ErrorCode.UNKNOWN,
      'password-rotation-required',
      'Your password must be changed before any other action.'
    )
  }

  const parsed = PanelExportBedSchema.safeParse({
    panelId: numberParam(first(request.query.panelId)),
    assembly: first(request.query.assembly),
    paddingBp: numberParam(first(request.query.paddingBp))
  })
  if (!parsed.success) {
    return sendError(
      reply,
      400,
      ErrorCode.INVALID_PARAMETERS,
      'invalid-panel-bed-params',
      'Invalid BED export parameters.'
    )
  }

  const { panelId, assembly, paddingBp } = parsed.data
  let bed: Awaited<ReturnType<typeof generateBedContentForSession>>
  try {
    bed = await generateBedContentForSession(
      deps.session,
      panelId,
      assembly,
      paddingBp,
      getWebGeneReferenceService()
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const notFound = message.includes('not found')
    return sendError(
      reply,
      notFound ? 404 : 422,
      notFound ? ErrorCode.NOT_FOUND : ErrorCode.INVALID_PARAMETERS,
      message,
      message
    )
  }

  await recordApiReadAudit(deps, { key: 'panels:exportBed', username: user.username })
  return reply
    .code(200)
    .header('content-type', 'text/plain; charset=utf-8')
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', 'no-store')
    .header('content-disposition', `attachment; filename="${bedFileName(bed.panelName, assembly)}"`)
    .send(`${bed.lines.join('\n')}\n`)
}

export function registerPanelBedDownloadRoute(app: FastifyInstance, deps: DispatcherDeps): void {
  app.get<{ Querystring: Query }>(
    PANEL_BED_DOWNLOAD_PATH,
    {
      schema: {
        tags: ['panels'],
        summary: 'Download a gene panel as a BED file',
        description:
          'Returns the panel genes as BED intervals (0-based, half-open) for one assembly. ' +
          'Query: panelId, assembly, paddingBp.'
      }
    },
    async (request, reply) => handleBedDownload(request, reply, deps)
  )
}
