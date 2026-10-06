/**
 * Web export delivery: prepare (POST) → signed single-use download (GET).
 *
 *   1. `POST /api/export/prepareDownload` (dispatcher override, analyst+,
 *      CSRF-gated like every POST) validates an ExportArtifactRequest and
 *      returns `{ downloadPath, expiresAt }` holding a short-lived signed
 *      grant (downloads/download-grants.ts explains the choice).
 *   2. The SPA navigates a hidden `<a download>` to `GET /api/download/:token`.
 *      The route redeems the grant for the session user, re-checks the role,
 *      audits the export and streams the artifact (CSV / XLSX / BED) as an
 *      attachment. The browser's download manager consumes the stream, so a
 *      large export never sits in page or server memory.
 *
 * Progress is pushed to the requesting user as `export:progress` SSE events.
 * A client abort destroys the response stream, which returns the row
 * iterator and releases its pooled Postgres client.
 */
import { Readable } from 'node:stream'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { ErrorCode, type SerializableError } from '../../../shared/types/errors'
import type { ExportProgress } from '../../../shared/ipc/domains/export'
import { recordApiReadAudit } from '../audit'
import { DownloadGrantRegistry } from '../downloads/download-grants'
import {
  ExportArtifactRequestSchema,
  openExportArtifact,
  type ExportArtifactRequest
} from '../downloads/export-artifacts'
import { requireOperation } from '../security/secure'
import type { DispatcherDeps, OverrideHandler } from './types'

export const DOWNLOAD_ROUTE = '/api/download/:token'
const PROGRESS_INTERVAL_MS = 250

let defaultGrants: DownloadGrantRegistry<ExportArtifactRequest> | null = null

export function downloadGrants(deps: DispatcherDeps): DownloadGrantRegistry<ExportArtifactRequest> {
  if (deps.downloadGrants !== undefined) return deps.downloadGrants
  defaultGrants ??= new DownloadGrantRegistry<ExportArtifactRequest>()
  return defaultGrants
}

function jsonError(
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  message: string,
  userMessage: string
): FastifyReply {
  return reply
    .code(status)
    .header('cache-control', 'no-store')
    .send({ code, message, userMessage } satisfies SerializableError)
}

export function buildExportDownloadOverrides(): Record<string, OverrideHandler> {
  return {
    'export:prepareDownload': {
      handle(args, request, reply, deps) {
        const user = request.session?.user
        if (user === undefined) {
          reply.code(401)
          return { error: 'unauthenticated' }
        }
        const parsed = ExportArtifactRequestSchema.safeParse(args[0])
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-export-request', message: parsed.error.message }
        }
        const { token, expiresAt } = downloadGrants(deps).issue(user, parsed.data)
        return { downloadPath: `download/${token}`, expiresAt }
      }
    }
  }
}

function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function progressPublisher(
  deps: DispatcherDeps,
  userId: number,
  downloadId: string,
  fileName: string
): (rows: number, done: boolean) => void {
  let lastSent = 0
  return (rows, done) => {
    const now = Date.now()
    if (!done && now - lastSent < PROGRESS_INTERVAL_MS) return
    lastSent = now
    const payload: ExportProgress = { current: rows, total: 0, done, downloadId, fileName }
    deps.events.publish(userId, 'export:progress', payload)
  }
}

function mapOpenError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error)
  if (/not found/i.test(message)) {
    return jsonError(reply, 404, ErrorCode.NOT_FOUND, message, message)
  }
  if (/no genes|no coordinates/i.test(message)) {
    return jsonError(reply, 422, ErrorCode.INVALID_PARAMETERS, message, message)
  }
  reply.log.error({ err: error }, 'export artifact failed before streaming')
  return jsonError(reply, 500, ErrorCode.UNKNOWN, 'export failed', 'The export failed. Try again.')
}

async function handleDownload(
  request: FastifyRequest<{ Params: { token: string } }>,
  reply: FastifyReply,
  deps: DispatcherDeps
): Promise<FastifyReply> {
  const actor = requireOperation('http:export:download', request, reply)
  if (actor === undefined) return reply
  if (request.session.mustChangePassword === true) {
    return jsonError(
      reply,
      403,
      ErrorCode.UNKNOWN,
      'password-rotation-required',
      'Your password must be changed before any other action.'
    )
  }

  const redeemed = downloadGrants(deps).redeem(request.params.token, actor.id)
  if (!redeemed.ok) {
    request.log.warn({ event: 'web-export', reason: redeemed.reason }, 'download grant refused')
    if (redeemed.reason === 'wrong-user') {
      return jsonError(reply, 403, ErrorCode.UNKNOWN, 'download-forbidden', 'Not your download.')
    }
    const expired = redeemed.reason === 'expired'
    return jsonError(
      reply,
      expired ? 410 : 404,
      ErrorCode.NOT_FOUND,
      expired ? 'download-expired' : 'download-not-found',
      'This download link has expired or was already used. Start the export again.'
    )
  }

  const { grant } = redeemed
  let progress: (rows: number, done: boolean) => void = () => undefined
  let artifact
  try {
    artifact = await openExportArtifact(grant.artifact, deps.session, (rows, done) =>
      progress(rows, done)
    )
  } catch (error) {
    return mapOpenError(reply, error)
  }
  progress = progressPublisher(deps, actor.id, grant.id, artifact.fileName)
  await recordApiReadAudit(deps, { key: artifact.auditKey, username: actor.username })

  const source = Readable.from(artifact.body, { objectMode: false })
  let completed = false
  source.once('end', () => {
    completed = true
    request.log.info({ event: 'web-export', key: artifact.auditKey }, 'web export finished')
  })
  source.once('close', () => {
    if (completed) return
    artifact.release().catch((error: unknown) => {
      request.log.warn({ event: 'web-export', err: error }, 'export source release failed')
    })
  })

  return reply
    .header('content-type', artifact.contentType)
    .header('content-disposition', attachmentDisposition(artifact.fileName))
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .send(source)
}

export function registerExportDownloadRoutes(app: FastifyInstance, deps: DispatcherDeps): void {
  app.get<{ Params: { token: string } }>(
    DOWNLOAD_ROUTE,
    {
      schema: {
        tags: ['export'],
        summary: 'Download a prepared export artifact (CSV, XLSX or BED)',
        description:
          'Redeems a single-use, user-bound, short-lived token returned by ' +
          'POST /api/export/prepareDownload and streams the artifact as an attachment.'
      }
    },
    async (request, reply) => handleDownload(request, reply, deps)
  )
}
