import { basename, isAbsolute } from 'node:path'

import { cancelImport, startImport } from '../../../main/ipc/handlers/import-logic'
import { jobRunner } from '../../../main/services/jobs/runner'
import type { StorageWriteTask } from '../../../main/storage/write-executor'
import {
  cleanupZipTemp,
  extractZip,
  testZipPassword
} from '../../../main/ipc/handlers/batch-import-logic'
import { extractCaseName } from '../../../main/import/batch-utils'
import { ImportServerPathArgSchema } from '../../../shared/api/schemas/import'
import { BatchImportRunIdSchema } from '../../../shared/ipc/domains/batch-import-schemas'
import type { BatchResult, DuplicateChoice } from '../../../shared/types/api'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import {
  WEB_EVENT_BATCH_IMPORT_COMPLETE,
  WEB_EVENT_BATCH_IMPORT_PROGRESS,
  WEB_EVENT_COHORT_SUMMARY_REBUILT
} from '../web-event-types'
import { serverPathImportDisabled, serverPathImportDisabledResponse } from './server-path-import'
import type { OverrideHandler } from './types'
import { isWebUploadRef, resolveWebUploadRef, stageExistingFileUpload } from './upload-staging'

const DELETE_CASE_TASK_TYPE = ['cases', 'delete'].join(':')

interface ResolvedBatchFile {
  inputPath: string
  storedPath: string
  fileName: string
}

interface WebBatchImportJobParams {
  files: ResolvedBatchFile[]
  duplicateStrategy: DuplicateChoice
  stripText: string | undefined
  runId: string
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
    'batch-import:selectFiles': {
      handle() {
        return []
      }
    },

    'batch-import:selectFolder': {
      handle() {
        return []
      }
    },

    'batch-import:selectZip': {
      handle() {
        return null
      }
    },

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

        const existingNames = new Set((await session.listCases()).map((item) => item.name))
        let duplicateCount = 0
        const files = resolution.files.map((file) => {
          const caseName = extractCaseName(
            file.fileName,
            typeof stripText === 'string' ? stripText : undefined
          )
          const isDuplicate = existingNames.has(caseName)
          if (isDuplicate) duplicateCount++
          return {
            filePath: file.inputPath,
            fileName: file.fileName,
            caseName,
            isDuplicate
          }
        })

        return { files, duplicateCount }
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

        const handle = jobRunner.enqueue<WebBatchImportJobParams, BatchResult>(
          'import_batch',
          {
            files: resolution.files,
            duplicateStrategy,
            stripText: typeof stripText === 'string' ? stripText : undefined,
            runId: parsedRunId.data
          },
          async (ctx, params) => {
            ctx.registerCancel(cancelImport)
            return await startWebBatchImport(
              params.files,
              params.duplicateStrategy,
              params.stripText,
              params.runId,
              request.session.user?.id,
              session,
              events,
              ctx.signal
            )
          }
        )
        return await handle.result
      }
    },

    'batch-import:cancel': {
      async handle() {
        const runningBatchJobs = jobRunner.list({ kind: 'import_batch', status: 'running' })
        await Promise.all(runningBatchJobs.map((job) => jobRunner.cancel(job.id)))
        cancelImport()
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

async function startWebBatchImport(
  files: ResolvedBatchFile[],
  duplicateStrategy: DuplicateChoice,
  stripText: string | undefined,
  runId: string,
  userId: number | undefined,
  session: Parameters<OverrideHandler['handle']>[3]['session'],
  events: Parameters<OverrideHandler['handle']>[3]['events'],
  signal: AbortSignal
): Promise<BatchResult> {
  if (userId !== undefined) {
    events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: true })
  }

  const existingCases = await session.listCases()
  const existingCaseIdsByName = new Map(existingCases.map((item) => [item.name, item.id]))
  const result: BatchResult = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: false,
    details: []
  }

  for (let index = 0; index < files.length; index++) {
    if (signal.aborted) {
      result.cancelled = true
      break
    }

    const file = files[index]
    const caseName = extractCaseName(file.fileName, stripText)
    const existingCaseId = existingCaseIdsByName.get(caseName)

    if (existingCaseId !== undefined && duplicateStrategy === 'skip') {
      result.skipped++
      result.details.push({
        filePath: file.inputPath,
        fileName: file.fileName,
        caseName,
        status: 'skipped'
      })
      continue
    }

    try {
      if (existingCaseId !== undefined) {
        await session
          .getWriteExecutor()
          .execute({ type: DELETE_CASE_TASK_TYPE, params: [existingCaseId] } as StorageWriteTask)
        existingCaseIdsByName.delete(caseName)
      }

      const importResult = await startImport(file.storedPath, caseName, undefined, () => session, {
        onProgress: (progress) => {
          if (userId === undefined) return
          events.publish(userId, WEB_EVENT_BATCH_IMPORT_PROGRESS, {
            runId,
            currentIndex: index,
            totalFiles: files.length,
            currentFileName: file.fileName,
            overallPercent: Math.round(((index + 1) / files.length) * 100),
            fileProgress: progress
          })
        }
      })

      result.succeeded++
      result.details.push({
        filePath: file.inputPath,
        fileName: file.fileName,
        caseName,
        status: 'success',
        variantCount: importResult.variantCount
      })
      existingCaseIdsByName.set(caseName, importResult.caseId)
    } catch (error) {
      if (signal.aborted) {
        result.cancelled = true
        break
      }

      result.failed++
      result.details.push({
        filePath: file.inputPath,
        fileName: file.fileName,
        caseName,
        status: 'failed',
        error: formatBatchError(error)
      })
    }
  }

  if (userId !== undefined) {
    events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: false })
    events.publish(userId, WEB_EVENT_BATCH_IMPORT_COMPLETE, { ...result, runId })
  }

  return result
}

function formatBatchError(error: unknown): string {
  return formatErrorMessage(error, 'Import failed')
}
