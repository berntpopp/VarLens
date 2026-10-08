import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { ErrorCode } from '../../../shared/types/errors'

import { recordApiWriteAudit } from '../audit'
import { requireOperation } from '../security/secure'
import type { DispatcherDeps } from './types'

const DEFAULT_RECOVERY_KEY_DIR = '/data'
const DEFAULT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
const DEFAULT_MAX_STAGED_BYTES_PER_USER = 20 * 1024 * 1024 * 1024
const UPLOAD_REF_PREFIX = 'web-upload:'
/** How long a staged upload survives the import that used it (see holdWebUploads). */
export const UPLOAD_RELEASE_GRACE_MS = 5 * 60 * 1000
/** How long it survives an import that failed or was cancelled, so a retry needs no re-upload. */
export const UPLOAD_FAILED_RETENTION_MS = 60 * 60 * 1000
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/** Answered with HTTP 413; `code` tells one oversized file from a full per-user quota. */
export class UploadTooLargeError extends Error {
  constructor(
    readonly code: 'upload-too-large' | 'upload-quota-exceeded',
    message: string
  ) {
    super(message)
  }
}

export interface StagedUpload {
  id: string
  ref: string
  userId: number
  originalName: string
  storedPath: string
  size: number
  createdAt: number
  expiresAt: number
}

interface UploadRouteBody extends FastifyRequest {
  body: unknown
}

const stagedUploads = new Map<string, StagedUpload>()
/** Upload id → imports currently reading it. A held upload is never swept. */
const heldUploads = new Map<string, number>()

/**
 * Boot-time sweep. The index above is in memory, so whatever is on disk belongs
 * to a previous process and can never be resolved again. Only the `<userId>/`
 * directories this module creates are removed, in case the root is shared.
 */
export async function clearStagedUploads(): Promise<void> {
  stagedUploads.clear()
  heldUploads.clear()
  const root = resolveUploadRoot()
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => rm(join(root, entry.name), { recursive: true, force: true }))
  )
}

/**
 * Mark staged uploads as in use by an import; call the returned function when
 * the import settles (success, failure or cancel). From then on the upload
 * lives UPLOAD_RELEASE_GRACE_MS instead of the 24 h staging TTL — not zero,
 * because a multi-sample VCF is imported with one call per sample on the same
 * ref. Pass `false` for an import that failed or was cancelled: the upload
 * then lives UPLOAD_FAILED_RETENTION_MS (or the staging TTL, if shorter), so a
 * retry with corrected options needs no second upload. Values that are not
 * known upload refs are ignored.
 */
export function holdWebUploads(refs: readonly unknown[]): (imported?: boolean) => void {
  const ids = refs.flatMap((ref) => {
    const id = typeof ref === 'string' ? parseWebUploadId(ref) : null
    return id !== null && stagedUploads.has(id) ? [id] : []
  })
  for (const id of ids) heldUploads.set(id, (heldUploads.get(id) ?? 0) + 1)

  return (imported = true) => {
    const retention = imported
      ? UPLOAD_RELEASE_GRACE_MS
      : Math.min(UPLOAD_FAILED_RETENTION_MS, resolveUploadTtlMs())
    for (const id of ids) {
      const holds = (heldUploads.get(id) ?? 1) - 1
      if (holds > 0) {
        heldUploads.set(id, holds)
        continue
      }
      heldUploads.delete(id)
      const upload = stagedUploads.get(id)
      if (upload !== undefined) upload.expiresAt = Date.now() + retention
    }
    setTimeout(cleanupExpiredUploads, retention + 1).unref()
  }
}

/** Delete staged uploads now, e.g. the files of an extraction that was refused. */
export function discardWebUploads(uploads: readonly StagedUpload[]): void {
  for (const upload of uploads) {
    void deleteUpload(upload)
    stagedUploads.delete(upload.id)
  }
}

export function isWebUploadRef(value: string): boolean {
  return parseWebUploadId(value) !== null
}

export function resolveWebUploadRef(value: string, userId: number): StagedUpload | null {
  cleanupExpiredUploads()
  const id = parseWebUploadId(value)
  if (id === null) return null

  const upload = stagedUploads.get(id)
  if (upload === undefined || upload.userId !== userId) return null
  const expired = upload.expiresAt <= Date.now() && !heldUploads.has(upload.id)
  if (expired || !existsSync(upload.storedPath)) {
    discardWebUploads([upload])
    return null
  }

  return upload
}

export function resolveWebUploadPath(value: string, userId: number): string | null {
  return resolveWebUploadRef(value, userId)?.storedPath ?? null
}

export function replaceWebUploadPathWithRef<T extends { filePath: string }>(
  item: T,
  pathToRef: Map<string, string>
): T {
  const ref = pathToRef.get(item.filePath)
  return ref === undefined ? item : { ...item, filePath: ref }
}

export function registerImportUploadRoutes(app: FastifyInstance, deps?: DispatcherDeps): void {
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload)
  })

  app.post('/api/import/upload', async (request: UploadRouteBody, reply) => {
    const gate = gateUploadRequest('http:import:upload', request, reply)
    if ('refused' in gate) {
      deps?.metrics?.recordOperationEvent({
        operation: 'upload-stage',
        result: 'error',
        failureClass: gate.refused
      })
      return gate.body
    }
    const { userId } = gate

    const originalName = headerString(request.headers['x-varlens-file-name'])
    if (originalName === undefined || originalName.trim() === '') {
      deps?.metrics?.recordOperationEvent({
        operation: 'upload-stage',
        result: 'error',
        failureClass: 'missing-file-name'
      })
      reply.code(400)
      return { error: 'missing-file-name', message: 'X-VarLens-File-Name is required' }
    }

    const safeName = sanitizeUploadName(originalName)
    if (!isAllowedUploadName(safeName)) {
      deps?.metrics?.recordOperationEvent({
        operation: 'upload-stage',
        result: 'error',
        failureClass: 'unsupported-file-type'
      })
      reply.code(400)
      return {
        error: 'unsupported-file-type',
        message: 'Only VCF, JSON, BED, GZIP, and ZIP files are supported'
      }
    }

    const source = toReadable(request.body)
    if (source === null) {
      deps?.metrics?.recordOperationEvent({
        operation: 'upload-stage',
        result: 'error',
        failureClass: 'missing-body'
      })
      reply.code(400)
      return { error: 'missing-body', message: 'Upload body is required' }
    }

    cleanupExpiredUploads()

    const upload = await stageUpload({
      userId,
      originalName,
      safeName,
      source
    }).catch((error: unknown) => {
      if (error instanceof UploadTooLargeError) {
        deps?.metrics?.recordOperationEvent({
          operation: 'upload-stage',
          result: 'error',
          failureClass: error.code
        })
        reply.code(413)
        return {
          error: error.code,
          message: error.message
        }
      }
      throw error
    })

    if (!isStagedUpload(upload)) return upload

    if (deps !== undefined) {
      await recordApiWriteAudit(deps, {
        key: 'import:upload',
        username: request.session.user?.username
      })
      deps.metrics?.recordOperationEvent({ operation: 'upload-stage', result: 'success' })
    }

    return {
      id: upload.id,
      ref: upload.ref,
      fileName: upload.originalName,
      size: upload.size
    }
  })

  // Lets the browser give back the files of a selection it could not finish
  // (cap reached, cancelled) instead of leaving them staged for the whole TTL.
  app.delete('/api/import/upload', async (request, reply) => {
    const gate = gateUploadRequest('http:import:discardUpload', request, reply)
    if ('refused' in gate) return gate.body
    const ref = (request.query as { ref?: unknown }).ref
    const id = typeof ref === 'string' ? parseWebUploadId(ref) : null
    const upload = id === null ? undefined : stagedUploads.get(id)
    // Unknown, expired and foreign refs all answer 204: idempotent, and no existence oracle.
    if (upload !== undefined && upload.userId === gate.userId) {
      if (heldUploads.has(upload.id)) {
        reply.code(409)
        return { error: 'upload-in-use', message: 'An import is reading this upload' }
      }
      discardWebUploads([upload])
    }
    reply.code(204)
    return null
  })
}

/** Session, role and pre-rotation gate of the upload routes; sends nothing but the role refusal. */
function gateUploadRequest(
  key: string,
  request: FastifyRequest,
  reply: FastifyReply
): { userId: number } | { refused: 'unauthenticated' | 'forbidden'; body: unknown } {
  const userId = request.session?.user?.id
  if (userId === undefined) {
    reply.code(401)
    return {
      refused: 'unauthenticated',
      body: {
        code: 'UNAUTHENTICATED',
        message: 'authentication required',
        userMessage: 'Please log in to continue.'
      }
    }
  }
  // Staging an upload is the first step of an import: analysts and up.
  if (requireOperation(key, request, reply) === undefined) {
    return { refused: 'forbidden', body: reply }
  }
  // Same pre-rotation gate as the dispatcher and the download route.
  if (request.session.mustChangePassword === true) {
    reply.code(403)
    return {
      refused: 'forbidden',
      body: {
        code: ErrorCode.UNKNOWN,
        message: 'password-rotation-required',
        userMessage: 'Your password must be changed before any other action.'
      }
    }
  }
  return { userId }
}

export async function stageExistingFileUpload(params: {
  userId: number
  originalName: string
  sourcePath: string
}): Promise<StagedUpload> {
  const safeName = sanitizeUploadName(params.originalName)
  if (!isAllowedUploadName(safeName)) {
    throw new Error(`Unsupported uploaded file type: ${params.originalName}`)
  }
  return await stageUpload({
    userId: params.userId,
    originalName: params.originalName,
    safeName,
    source: createReadStream(params.sourcePath)
  })
}

async function stageUpload(params: {
  userId: number
  originalName: string
  safeName: string
  source: Readable
}): Promise<StagedUpload> {
  const id = randomUUID()
  const uploadDir = join(resolveUploadRoot(), String(params.userId), id)
  const storedPath = join(uploadDir, params.safeName)
  const maxBytes = resolveMaxUploadBytes()
  const maxStagedBytes = resolveMaxStagedBytesPerUser()
  const quotaExceeded = (): UploadTooLargeError =>
    new UploadTooLargeError(
      'upload-quota-exceeded',
      `Staged uploads would exceed the ${maxStagedBytes} byte limit per user ` +
        `(${(maxStagedBytes / 2 ** 30).toFixed(1)} GiB). Files of this selection that were ` +
        'already uploaded were discarded; import or wait for the expiry of earlier uploads, ' +
        'then try again with fewer files'
    )

  const quotaLeft = maxStagedBytes - stagedBytesOf(params.userId)

  await mkdir(uploadDir, { recursive: true, mode: 0o700 })

  let size: number
  try {
    const written = await writeLimitedUpload(params.source, storedPath, (bytes) => {
      if (bytes > maxBytes) {
        throw new UploadTooLargeError(
          'upload-too-large',
          `Upload exceeds the configured ${maxBytes} byte limit`
        )
      }
      if (bytes > quotaLeft) throw quotaExceeded()
    })
    // No await between this re-check and stagedUploads.set below: parallel
    // uploads of one user cannot each fit and together pass the cap.
    if (stagedBytesOf(params.userId) + written > maxStagedBytes) throw quotaExceeded()
    size = written
  } catch (error) {
    await rm(uploadDir, { recursive: true, force: true })
    throw error
  }

  const createdAt = Date.now()
  const upload: StagedUpload = {
    id,
    ref: `${UPLOAD_REF_PREFIX}${id}/${params.safeName}`,
    userId: params.userId,
    originalName: params.originalName,
    storedPath,
    size,
    createdAt,
    expiresAt: createdAt + resolveUploadTtlMs()
  }
  stagedUploads.set(upload.id, upload)
  // Sweep an upload nobody imports when it expires, not on some later request.
  setTimeout(
    cleanupExpiredUploads,
    Math.min(upload.expiresAt - createdAt + 1, MAX_TIMER_DELAY_MS)
  ).unref()
  return upload
}

async function writeLimitedUpload(
  source: Readable,
  storedPath: string,
  assertWithinLimits: (written: number) => void
): Promise<number> {
  const target = createWriteStream(storedPath, { mode: 0o600 })
  let written = 0

  try {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      written += buffer.length
      assertWithinLimits(written)
      if (!target.write(buffer)) {
        await once(target, 'drain')
      }
    }

    target.end()
    await finished(target)
    return written
  } catch (error) {
    target.destroy()
    throw error
  }
}

function isStagedUpload(value: unknown): value is StagedUpload {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    'ref' in value &&
    'storedPath' in value
  )
}

function parseWebUploadId(value: string): string | null {
  if (!value.startsWith(UPLOAD_REF_PREFIX)) return null
  const rest = value.slice(UPLOAD_REF_PREFIX.length)
  const slash = rest.indexOf('/')
  const id = slash === -1 ? rest : rest.slice(0, slash)
  return id.trim() === '' ? null : id
}

function resolveUploadRoot(): string {
  const rawRoot = process.env.VARLENS_WEB_UPLOAD_DIR
  const root =
    typeof rawRoot === 'string' && rawRoot.trim() !== ''
      ? rawRoot.trim()
      : join(resolveRecoveryKeyDir(), 'uploads')
  if (!isAbsolute(root)) {
    throw new Error(`VARLENS_WEB_UPLOAD_DIR must be an absolute path; got ${JSON.stringify(root)}`)
  }
  return root
}

function resolveRecoveryKeyDir(): string {
  const raw = process.env.VARLENS_RECOVERY_KEY_DIR
  const dir = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : DEFAULT_RECOVERY_KEY_DIR
  if (!isAbsolute(dir)) {
    throw new Error(`VARLENS_RECOVERY_KEY_DIR must be an absolute path; got ${JSON.stringify(dir)}`)
  }
  return dir
}

function resolveUploadTtlMs(): number {
  return resolvePositiveIntegerEnv('VARLENS_WEB_UPLOAD_TTL_MS', DEFAULT_UPLOAD_TTL_MS)
}

function resolveMaxUploadBytes(): number {
  return resolvePositiveIntegerEnv('VARLENS_WEB_MAX_UPLOAD_BYTES', DEFAULT_MAX_UPLOAD_BYTES)
}

function resolveMaxStagedBytesPerUser(): number {
  return resolvePositiveIntegerEnv(
    'VARLENS_WEB_MAX_STAGED_BYTES_PER_USER',
    DEFAULT_MAX_STAGED_BYTES_PER_USER
  )
}

function stagedBytesOf(userId: number): number {
  let bytes = 0
  for (const upload of stagedUploads.values()) if (upload.userId === userId) bytes += upload.size
  return bytes
}

function resolvePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; got ${raw}`)
  }
  return value
}

function sanitizeUploadName(value: string): string {
  const base = basename(value).trim()
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_')
  return safe === '' || safe === '.' || safe === '..' ? 'upload.dat' : safe
}

function isAllowedUploadName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.vcf') ||
    lower.endsWith('.vcf.gz') ||
    lower.endsWith('.json') ||
    lower.endsWith('.json.gz') ||
    lower.endsWith('.bed') ||
    lower.endsWith('.zip') ||
    lower.endsWith('.gz')
  )
}

function toReadable(value: unknown): Readable | null {
  if (Buffer.isBuffer(value)) return Readable.from(value)
  if (value instanceof Readable) return value
  if (value !== null && typeof value === 'object' && 'pipe' in value) {
    return value as Readable
  }
  return null
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function cleanupExpiredUploads(): void {
  const now = Date.now()
  for (const upload of stagedUploads.values()) {
    if (upload.expiresAt > now || heldUploads.has(upload.id)) continue
    discardWebUploads([upload])
  }
}

async function deleteUpload(upload: StagedUpload): Promise<void> {
  await rm(dirname(upload.storedPath), { recursive: true, force: true })
}
