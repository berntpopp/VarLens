import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

import type { FastifyInstance, FastifyRequest } from 'fastify'

import { recordApiWriteAudit } from '../audit'
import type { DispatcherDeps } from './types'

const DEFAULT_RECOVERY_KEY_DIR = '/data'
const DEFAULT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
const UPLOAD_REF_PREFIX = 'web-upload:'

class UploadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Upload exceeds the configured ${maxBytes} byte limit`)
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

export function isWebUploadRef(value: string): boolean {
  return parseWebUploadId(value) !== null
}

export function resolveWebUploadRef(value: string, userId: number): StagedUpload | null {
  cleanupExpiredUploads()
  const id = parseWebUploadId(value)
  if (id === null) return null

  const upload = stagedUploads.get(id)
  if (upload === undefined || upload.userId !== userId) return null
  if (upload.expiresAt <= Date.now() || !existsSync(upload.storedPath)) {
    void deleteUpload(upload)
    stagedUploads.delete(upload.id)
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
    const userId = request.session.user?.id
    if (userId === undefined) {
      deps?.metrics?.recordOperationEvent({
        operation: 'upload-stage',
        result: 'error',
        failureClass: 'unauthenticated'
      })
      reply.code(401)
      return {
        code: 'UNAUTHENTICATED',
        message: 'authentication required',
        userMessage: 'Please log in to continue.'
      }
    }

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
          failureClass: 'upload-too-large'
        })
        reply.code(413)
        return {
          error: 'upload-too-large',
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

  await mkdir(uploadDir, { recursive: true, mode: 0o700 })

  try {
    await writeLimitedUpload(params.source, storedPath, maxBytes)
  } catch (error) {
    await rm(uploadDir, { recursive: true, force: true })
    throw error
  }

  const size = (await stat(storedPath)).size
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
  return upload
}

async function writeLimitedUpload(
  source: Readable,
  storedPath: string,
  maxBytes: number
): Promise<number> {
  const target = createWriteStream(storedPath, { mode: 0o600 })
  let written = 0

  try {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      written += buffer.length
      if (written > maxBytes) {
        throw new UploadTooLargeError(maxBytes)
      }
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
    if (upload.expiresAt > now) continue
    void deleteUpload(upload)
    stagedUploads.delete(upload.id)
  }
}

async function deleteUpload(upload: StagedUpload): Promise<void> {
  await rm(dirname(upload.storedPath), { recursive: true, force: true })
}
