import { basename, isAbsolute } from 'node:path'

import { cancelImport } from '../../../main/ipc/handlers/import-logic'
import {
  cleanupZipTemp,
  extractZip,
  inspectZip,
  testZipPassword
} from '../../../main/ipc/handlers/batch-import-logic'
import {
  checkSessionDuplicates,
  enqueueSessionBatchImport,
  type SessionBatchCallbacks
} from '../../../main/ipc/handlers/batch-import-session'
import { ImportServerPathArgSchema } from '../../../shared/api/schemas/import'
import { BatchImportRunIdSchema } from '../../../shared/ipc/domains/batch-import-schemas'
import { batchImportRuns, type BatchImportAccepted } from '../batch-import-runs'
import { toSerializableWebError } from '../dispatcher-errors'
import {
  WEB_EVENT_BATCH_IMPORT_COMPLETE,
  WEB_EVENT_BATCH_IMPORT_FAILED,
  WEB_EVENT_BATCH_IMPORT_FILE_COMPLETE,
  WEB_EVENT_BATCH_IMPORT_PROGRESS,
  WEB_EVENT_COHORT_SUMMARY_REBUILT
} from '../web-event-types'
import { serverPathImportDisabled, serverPathImportDisabledResponse } from './server-path-import'
import { jobViewerOf } from './jobs'
import type { DispatcherDeps, OverrideHandler } from './types'
import { isWebUploadRef, resolveWebUploadRef, stageExistingFileUpload } from './upload-staging'

interface ResolvedBatchFile {
  inputPath: string
  storedPath: string
  fileName: string
}

type BatchFileResolution =
  | { ok: true; files: ResolvedBatchFile[] }
  | {
      ok: false
      status: 400 | 403 | 404
      body: { error: string; message: string }
    }

export function buildBatchImportOverrides(): Record<string, OverrideHandler> {
  return {
    'batch-import:checkDuplicates': {
      async handle(args, request, reply, { session }) {
        const [filePaths, stripText] = args
        if (!Array.isArray(filePaths)) {
          reply.code(400)
          return { error: 'invalid-files', message: 'filePaths must be an array' }
        }

        const resolution = resolveBatchFiles(filePaths, request.session.user?.id)
        if (!resolution.ok) {
          reply.code(resolution.status)
          return resolution.body
        }

        return await checkSessionDuplicates(
          session,
          resolution.files.map((file) => ({ filePath: file.inputPath, fileName: file.fileName })),
          typeof stripText === 'string' ? stripText : undefined
        )
      }
    },

    'batch-import:start': {
      async handle(args, request, reply, { session, events }) {
        const [filePaths, duplicateStrategy, stripText, runId] = args
        if (!Array.isArray(filePaths)) {
          reply.code(400)
          return { error: 'invalid-files', message: 'filePaths must be an array' }
        }
        if (duplicateStrategy !== 'skip' && duplicateStrategy !== 'overwrite') {
          reply.code(400)
          return { error: 'invalid-duplicate-strategy', message: 'duplicateStrategy is invalid' }
        }
        const parsedRunId = BatchImportRunIdSchema.safeParse(runId)
        if (!parsedRunId.success) {
          reply.code(400)
          return { error: 'invalid-run-id', message: 'runId is invalid' }
        }

        const resolution = resolveBatchFiles(filePaths, request.session.user?.id)
        if (!resolution.ok) {
          reply.code(resolution.status)
          return resolution.body
        }

        const userId = request.session.user?.id
        const validRunId = parsedRunId.data
        // Only the caller's own runs count: a refusal never reveals that
        // somebody else uses the id.
        if (userId === undefined || batchImportRuns.has(validRunId, userId)) {
          reply.code(400)
          return { error: 'invalid-run-id', message: 'runId is invalid' }
        }
        // Not awaited: the request ends here, the job runs on. A refusal to
        // enqueue (an import is already running) still throws synchronously
        // and is answered as an error.
        const job = enqueueSessionBatchImport({
          files: resolution.files,
          duplicateStrategy,
          stripText: typeof stripText === 'string' ? stripText : undefined,
          runId: validRunId,
          session,
          callbacks: webBatchCallbacks(events, userId, validRunId)
        })
        batchImportRuns.start(validRunId, userId, job.jobId)
        void job.result.then(
          (result) => batchImportRuns.complete(validRunId, userId, result),
          (error: unknown) => {
            const serialized = toSerializableWebError(error)
            batchImportRuns.fail(validRunId, userId, serialized)
            events.publish(userId, WEB_EVENT_BATCH_IMPORT_FAILED, {
              runId: validRunId,
              jobId: job.jobId,
              error: serialized
            })
          }
        )
        const accepted: BatchImportAccepted = {
          accepted: true,
          jobId: job.jobId,
          runId: validRunId
        }
        return accepted
      }
    },

    // Web only: where a run stands, for a client that reconnected, reloaded
    // or missed the completion event. Owner-checked inside the registry.
    'batch-import:status': {
      handle(args, request, reply) {
        const parsedRunId = BatchImportRunIdSchema.safeParse(args[0])
        const user = request.session.user
        if (!parsedRunId.success || user === undefined) {
          reply.code(400)
          return { error: 'invalid-run-id', message: 'runId is invalid' }
        }
        return batchImportRuns.status(parsedRunId.data, {
          userId: user.id,
          isAdmin: user.role === 'admin'
        })
      }
    },

    'batch-import:cancel': {
      async handle(_args, request, _reply, { jobs }) {
        // Owner-checked (see import:cancel): 403 for another user's batch.
        if (jobs === undefined) return
        const cancelled = await jobs.registry.cancelActive(jobViewerOf(request), [
          'import_batch',
          'import_single'
        ])
        if (cancelled > 0) cancelImport()
      }
    },

    'batch-import:extractZip': {
      async handle(args, request, reply) {
        const [zipPath, password] = args
        const validatedZipPath = ImportServerPathArgSchema.safeParse(zipPath)
        if (!validatedZipPath.success) {
          reply.code(400)
          return { error: 'invalid-zip-path', message: 'zipPath must be a file path' }
        }

        if (isWebUploadRef(validatedZipPath.data)) {
          const result = await extractWebUploadZip(
            validatedZipPath.data,
            request.session.user?.id,
            typeof password === 'string' ? password : undefined
          )
          if (result === null) {
            reply.code(404)
            return {
              error: 'upload-not-found',
              message: 'Uploaded ZIP file is no longer available'
            }
          }
          return result
        }

        if (serverPathImportDisabled() || !isAbsolute(validatedZipPath.data)) {
          reply.code(serverPathImportDisabled() ? 403 : 400)
          return serverPathImportDisabled()
            ? serverPathImportDisabledResponse()
            : { error: 'invalid-zip-path', message: 'zipPath must be an absolute path' }
        }
        return await extractZip(
          validatedZipPath.data,
          typeof password === 'string' ? password : undefined
        )
      }
    },

    // Web half of desktop `selectZip`: the browser uploads the archive, then
    // asks whether it is encrypted (shared inspectZip, P-08).
    'batch-import:inspectZip': {
      async handle(args, request, reply) {
        const [zipRef] = args
        const validated = ImportServerPathArgSchema.safeParse(zipRef)
        if (!validated.success || !isWebUploadRef(validated.data)) {
          reply.code(400)
          return { error: 'invalid-zip-ref', message: 'zipRef must be an upload ref' }
        }
        const upload = resolveUploadedFile(validated.data, request.session.user?.id)
        if (upload === null) {
          reply.code(404)
          return { error: 'upload-not-found', message: 'Uploaded ZIP file is no longer available' }
        }
        return await inspectZip(upload.storedPath)
      }
    },

    'batch-import:testZipPassword': {
      handle(args, request, reply) {
        const [zipPath, password] = args
        const validatedZipPath = ImportServerPathArgSchema.safeParse(zipPath)
        if (!validatedZipPath.success) {
          reply.code(400)
          return { error: 'invalid-zip-path', message: 'zipPath must be a file path' }
        }

        if (isWebUploadRef(validatedZipPath.data)) {
          const upload = resolveUploadedFile(validatedZipPath.data, request.session.user?.id)
          if (upload === null) {
            reply.code(404)
            return {
              error: 'upload-not-found',
              message: 'Uploaded ZIP file is no longer available'
            }
          }
          return testZipPassword(upload.storedPath, typeof password === 'string' ? password : '')
        }

        if (serverPathImportDisabled() || !isAbsolute(validatedZipPath.data)) {
          reply.code(serverPathImportDisabled() ? 403 : 400)
          return serverPathImportDisabled()
            ? serverPathImportDisabledResponse()
            : { error: 'invalid-zip-path', message: 'zipPath must be an absolute path' }
        }
        return testZipPassword(validatedZipPath.data, typeof password === 'string' ? password : '')
      }
    },

    'batch-import:cleanupZipTemp': {
      handle(args, _request, reply) {
        const [extractionId] = args
        if (typeof extractionId !== 'string' || extractionId.length === 0) {
          reply.code(400)
          return { error: 'invalid-extraction-id', message: 'extractionId is required' }
        }
        cleanupZipTemp(extractionId)
      }
    }
  }
}

function resolveUploadedFile(value: string, userId: number | undefined): ResolvedBatchFile | null {
  if (userId === undefined) return null
  const upload = resolveWebUploadRef(value, userId)
  if (upload === null) return null
  return {
    inputPath: upload.ref,
    storedPath: upload.storedPath,
    fileName: upload.originalName
  }
}

async function extractWebUploadZip(
  zipRef: string,
  userId: number | undefined,
  password: string | undefined
): Promise<{ files: string[]; errors: string[]; extractionId: string } | null> {
  const upload = resolveUploadedFile(zipRef, userId)
  if (upload === null || userId === undefined) return null

  const result = await extractZip(upload.storedPath, password)
  try {
    const stagedFiles = []
    for (const filePath of result.files) {
      stagedFiles.push(
        await stageExistingFileUpload({
          userId,
          originalName: basename(filePath),
          sourcePath: filePath
        })
      )
    }
    return {
      files: stagedFiles.map((file) => file.ref),
      errors: result.errors,
      extractionId: result.extractionId
    }
  } finally {
    cleanupZipTemp(result.extractionId)
  }
}

function resolveBatchFiles(values: unknown[], userId: number | undefined): BatchFileResolution {
  const resolved: ResolvedBatchFile[] = []
  for (const raw of values) {
    const parsed = ImportServerPathArgSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        status: 400,
        body: { error: 'invalid-file-path', message: 'filePath must be a file path' }
      }
    }

    if (isWebUploadRef(parsed.data)) {
      const upload = resolveUploadedFile(parsed.data, userId)
      if (upload === null) {
        return {
          ok: false,
          status: 404,
          body: { error: 'upload-not-found', message: 'Uploaded file is no longer available' }
        }
      }
      resolved.push(upload)
      continue
    }

    if (serverPathImportDisabled() || !isAbsolute(parsed.data)) {
      return {
        ok: false,
        status: serverPathImportDisabled() ? 403 : 400,
        body: serverPathImportDisabled()
          ? serverPathImportDisabledResponse()
          : { error: 'invalid-file-path', message: 'filePath must be an absolute path' }
      }
    }
    resolved.push({
      inputPath: parsed.data,
      storedPath: parsed.data,
      fileName: basename(parsed.data) || 'unknown'
    })
  }
  return { ok: true, files: resolved }
}

/** Per-user SSE wiring for the shared session batch (runId lets the client match its run). */
function webBatchCallbacks(
  events: DispatcherDeps['events'],
  userId: number | undefined,
  runId: string
): SessionBatchCallbacks {
  if (userId === undefined) return {}
  return {
    onCohortStale: (data) => events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, data),
    onProgress: (progress) =>
      events.publish(userId, WEB_EVENT_BATCH_IMPORT_PROGRESS, { ...progress, runId }),
    onFileComplete: (event) =>
      events.publish(userId, WEB_EVENT_BATCH_IMPORT_FILE_COMPLETE, { ...event, runId }),
    onComplete: (result) =>
      events.publish(userId, WEB_EVENT_BATCH_IMPORT_COMPLETE, { ...result, runId })
  }
}
