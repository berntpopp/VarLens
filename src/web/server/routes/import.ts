import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve, isAbsolute } from 'node:path'

import {
  cancelImport,
  getVcfMultiPreview,
  getVcfPreview,
  startImport,
  startMultiFileImport
} from '../../../main/ipc/handlers/import-logic'
import {
  ImportCaseNameArgSchema,
  ImportMultiFileSpecSchema,
  ImportServerPathArgSchema,
  ImportVariantTypeArgSchema,
  normalizeImportFiltersPayload,
  normalizeImportMultiFileSpec,
  normalizeImportVcfOptions
} from '../../../shared/api/schemas/import'
import type { MultiFileImportSpec } from '../../../shared/types/api'
import {
  validateAnnotationBundleManifest,
  type AnnotationBundleFile,
  type AnnotationBundleFileRole
} from '../../../shared/annotations/annotation-bundle'
import { WEB_EVENT_COHORT_SUMMARY_REBUILT, WEB_EVENT_IMPORT_PROGRESS } from '../web-event-types'
import { serverPathImportDisabled, serverPathImportDisabledResponse } from './server-path-import'
import type { OverrideHandler } from './types'
import {
  isWebUploadRef,
  replaceWebUploadPathWithRef,
  resolveWebUploadPath,
  resolveWebUploadRef
} from './upload-staging'

export function buildImportOverrides(): Record<string, OverrideHandler> {
  return {
    'import:selectFile': {
      handle() {
        return null
      }
    },

    'import:selectFiles': {
      handle() {
        return []
      }
    },

    'import:selectBedFile': {
      handle() {
        return null
      }
    },

    'import:vcfPreview': {
      async handle(args, request, reply) {
        const [filePath] = args
        const validatedFilePath = ImportServerPathArgSchema.safeParse(filePath)
        if (!validatedFilePath.success) {
          reply.code(400)
          return { error: 'invalid-file-path', message: 'filePath must be a non-empty string' }
        }

        const resolved = resolveImportPath(validatedFilePath.data, request.session.user?.id)
        if (resolved === null) {
          reply.code(isWebUploadRef(validatedFilePath.data) ? 404 : 403)
          return isWebUploadRef(validatedFilePath.data)
            ? { error: 'upload-not-found', message: 'Uploaded file is no longer available' }
            : serverPathImportDisabledResponse()
        }

        const preview = (await getVcfPreview(resolved.path)) as { filePath?: string }
        return { ...preview, filePath: resolved.ref ?? resolved.path }
      }
    },

    'import:vcfMultiPreview': {
      async handle(args, request, reply) {
        const [filePaths] = args
        if (!Array.isArray(filePaths) || filePaths.length === 0) {
          reply.code(400)
          return { error: 'invalid-file-paths', message: 'filePaths must be a non-empty array' }
        }

        const resolvedPaths: string[] = []
        const pathToRef = new Map<string, string>()
        for (const raw of filePaths) {
          const validatedFilePath = ImportServerPathArgSchema.safeParse(raw)
          if (!validatedFilePath.success) {
            reply.code(400)
            return { error: 'invalid-file-path', message: 'filePath must be a non-empty string' }
          }
          const resolved = resolveImportPath(validatedFilePath.data, request.session.user?.id)
          if (resolved === null) {
            reply.code(isWebUploadRef(validatedFilePath.data) ? 404 : 403)
            return isWebUploadRef(validatedFilePath.data)
              ? { error: 'upload-not-found', message: 'Uploaded file is no longer available' }
              : serverPathImportDisabledResponse()
          }
          resolvedPaths.push(resolved.path)
          if (resolved.ref !== null) pathToRef.set(resolved.path, resolved.ref)
        }

        const preview = (await getVcfMultiPreview(resolvedPaths)) as {
          files: Array<{ filePath: string }>
          siblingBedFiles: string[]
        }
        return {
          ...preview,
          files: preview.files.map((file) => replaceWebUploadPathWithRef(file, pathToRef)),
          siblingBedFiles: []
        }
      }
    },

    'import:start': {
      async handle(args, request, reply, { session, events }) {
        const [filePath, caseName, vcfOptions] = args
        const validatedFilePath = ImportServerPathArgSchema.safeParse(filePath)
        if (!validatedFilePath.success) {
          reply.code(400)
          return { error: 'invalid-file-path', message: 'filePath must be a non-empty string' }
        }
        const validatedCaseName = ImportCaseNameArgSchema.safeParse(caseName)
        if (!validatedCaseName.success) {
          reply.code(400)
          return { error: 'invalid-case-name', message: 'caseName must be a non-empty string' }
        }
        const resolved = resolveImportPath(validatedFilePath.data, request.session.user?.id)
        if (resolved === null) {
          reply.code(isWebUploadRef(validatedFilePath.data) ? 404 : 403)
          return isWebUploadRef(validatedFilePath.data)
            ? { error: 'upload-not-found', message: 'Uploaded file is no longer available' }
            : serverPathImportDisabledResponse()
        }

        const userId = request.session?.user?.id
        if (userId !== undefined) {
          events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: true })
        }
        try {
          return await startImport(
            resolved.path,
            validatedCaseName.data,
            normalizeImportVcfOptions(vcfOptions),
            () => session,
            {
              onProgress: (progress) => {
                if (userId !== undefined) {
                  events.publish(userId, WEB_EVENT_IMPORT_PROGRESS, progress)
                }
              }
            }
          )
        } finally {
          if (userId !== undefined) {
            events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: false })
          }
        }
      }
    },

    'import:startMultiFile': {
      async handle(args, request, reply, { session, events }) {
        const [caseName, files, vcfOptions, filters] = args
        const validatedCaseName = ImportCaseNameArgSchema.safeParse(caseName)
        if (!validatedCaseName.success) {
          reply.code(400)
          return { error: 'invalid-case-name', message: 'caseName must be a non-empty string' }
        }
        const validatedFiles = ImportMultiFileSpecSchema.array().min(1).safeParse(files)
        if (!validatedFiles.success) {
          reply.code(400)
          return { error: 'invalid-files', message: 'files must be a non-empty array' }
        }

        const normalizedFiles: MultiFileImportSpec[] = []
        const pathToRef = new Map<string, string>()
        for (const raw of validatedFiles.data) {
          const validatedFilePath = ImportServerPathArgSchema.safeParse(raw.filePath)
          if (!validatedFilePath.success) {
            reply.code(400)
            return { error: 'invalid-file-path', message: 'filePath must be a non-empty string' }
          }
          const resolved = resolveImportPath(validatedFilePath.data, request.session.user?.id)
          if (resolved === null) {
            reply.code(isWebUploadRef(validatedFilePath.data) ? 404 : 403)
            return isWebUploadRef(validatedFilePath.data)
              ? { error: 'upload-not-found', message: 'Uploaded file is no longer available' }
              : serverPathImportDisabledResponse()
          }
          const validatedVariantType = ImportVariantTypeArgSchema.safeParse(raw.variantType)
          if (!validatedVariantType.success) {
            reply.code(400)
            return { error: 'invalid-variant-type', message: 'variantType is required' }
          }
          normalizedFiles.push(
            normalizeImportMultiFileSpec({
              ...raw,
              filePath: resolved.path,
              variantType: validatedVariantType.data
            })
          )
          if (resolved.ref !== null) pathToRef.set(resolved.path, resolved.ref)
        }

        const resolvedFilters = resolveFilterUploadRefs(filters, request.session.user?.id)
        if (resolvedFilters === null) {
          reply.code(404)
          return { error: 'upload-not-found', message: 'Uploaded BED file is no longer available' }
        }
        if (
          resolvedFilters !== undefined &&
          resolvedFilters.bedFile !== undefined &&
          resolvedFilters.bedFile !== null &&
          !isAbsolute(resolvedFilters.bedFile)
        ) {
          reply.code(403)
          return serverPathImportDisabledResponse()
        }

        const normalizedFilters = normalizeImportFiltersPayload(resolvedFilters)
        if (filters !== undefined && filters !== null && normalizedFilters === undefined) {
          reply.code(400)
          return {
            error: 'invalid-filters',
            message: 'filters must match the import filter schema'
          }
        }

        const userId = request.session?.user?.id
        if (userId !== undefined) {
          events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: true })
        }
        try {
          const result = await startMultiFileImport(
            validatedCaseName.data,
            normalizedFiles,
            normalizeImportVcfOptions(vcfOptions),
            () => session,
            () => {
              throw new Error('SQLite database is not available in web mode')
            },
            {
              onProgress: (progress) => {
                if (userId !== undefined) {
                  events.publish(userId, WEB_EVENT_IMPORT_PROGRESS, progress)
                }
              }
            },
            undefined,
            normalizedFilters
          )
          return {
            ...result,
            files: result.files.map((file) => replaceWebUploadPathWithRef(file, pathToRef))
          }
        } finally {
          if (userId !== undefined) {
            events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: false })
          }
        }
      }
    },

    'import:startAnnotationBundle': {
      async handle(args, request, reply, { session, events }) {
        const [manifestPath, caseName, selectedSample] = args
        const validatedManifestPath = ImportServerPathArgSchema.safeParse(manifestPath)
        if (!validatedManifestPath.success) {
          reply.code(400)
          return { error: 'invalid-file-path', message: 'manifestPath must be a non-empty string' }
        }
        const validatedCaseName = ImportCaseNameArgSchema.safeParse(caseName)
        if (!validatedCaseName.success) {
          reply.code(400)
          return { error: 'invalid-case-name', message: 'caseName must be a non-empty string' }
        }

        const resolved = resolveImportPath(validatedManifestPath.data, request.session.user?.id)
        if (resolved === null) {
          reply.code(isWebUploadRef(validatedManifestPath.data) ? 404 : 403)
          return isWebUploadRef(validatedManifestPath.data)
            ? { error: 'upload-not-found', message: 'Uploaded file is no longer available' }
            : serverPathImportDisabledResponse()
        }

        let manifestInput: unknown
        try {
          manifestInput = JSON.parse(await readFile(resolved.path, 'utf8'))
        } catch (error) {
          reply.code(400)
          return {
            error: 'invalid-annotation-bundle-manifest',
            message: error instanceof Error ? error.message : String(error)
          }
        }

        const validation = validateAnnotationBundleManifest(manifestInput)
        if (
          !validation.ok ||
          validation.importPlan === undefined ||
          validation.manifest === undefined
        ) {
          reply.code(400)
          return {
            error: 'invalid-annotation-bundle-manifest',
            message: validation.errors.join('; ')
          }
        }

        try {
          await verifyBundleFiles(
            inferBundleRoot(resolved.path, validation.manifest.files),
            validation.manifest.files
          )
        } catch (error) {
          reply.code(400)
          return {
            error: 'invalid-annotation-bundle-files',
            message: error instanceof Error ? error.message : String(error)
          }
        }

        const variantFiles = validation.importPlan.variantFiles.filter((file) => file.required)
        if (variantFiles.length === 0) {
          reply.code(400)
          return {
            error: 'invalid-annotation-bundle-manifest',
            message: 'annotation bundle has no required variant VCFs to import'
          }
        }

        const bundleRoot = inferBundleRoot(resolved.path, validation.manifest.files)
        const files = variantFiles.map((file) => ({
          filePath: join(bundleRoot, file.path),
          variantType: variantTypeForBundleRole(file.role),
          caller: null,
          annotationFormat: 'csq'
        }))

        const userId = request.session?.user?.id
        if (userId !== undefined) {
          events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: true })
        }
        try {
          const result = await startMultiFileImport(
            validatedCaseName.data,
            files,
            {
              genomeBuild: validation.manifest.genomeBuild,
              ...(typeof selectedSample === 'string' && selectedSample !== ''
                ? { selectedSample }
                : {})
            },
            () => session,
            () => {
              throw new Error('SQLite database is not available in web mode')
            },
            {
              onProgress: (progress) => {
                if (userId !== undefined) {
                  events.publish(userId, WEB_EVENT_IMPORT_PROGRESS, progress)
                }
              }
            }
          )
          return {
            ...result,
            annotationBundle: {
              bundleId: validation.manifest.bundleId,
              mappingVersion: validation.manifest.mappingVersion,
              publicSnapshot: validation.manifest.publicSnapshot,
              sidecarHandling: 'preserved_metadata_only',
              sidecarFilesPreserved: validation.importPlan.sidecarFiles.map((file) => file.path),
              reportFilesPreserved: validation.importPlan.reportFiles.map((file) => file.path)
            }
          }
        } finally {
          if (userId !== undefined) {
            events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: false })
          }
        }
      }
    },

    'import:cancel': {
      handle() {
        cancelImport()
      }
    }
  }
}

function inferBundleRoot(manifestPath: string, files: AnnotationBundleFile[]): string {
  void files
  return dirname(resolve(manifestPath))
}

function variantTypeForBundleRole(role: AnnotationBundleFileRole): string {
  switch (role) {
    case 'snv_vcf':
      return 'snv'
    case 'sv_vcf':
      return 'sv'
    case 'cnv_vcf':
      return 'cnv'
    case 'str_vcf':
      return 'str'
    default:
      throw new Error(`unsupported variant bundle role: ${role}`)
  }
}

async function verifyBundleFiles(bundleRoot: string, files: AnnotationBundleFile[]): Promise<void> {
  for (const file of files) {
    await verifyOneBundlePath(bundleRoot, file.path, file.checksum, file.sizeBytes)
    if (file.indexPath !== undefined) {
      await verifyOneBundlePath(
        bundleRoot,
        file.indexPath,
        file.indexChecksum ?? '',
        file.indexSizeBytes ?? -1
      )
    }
  }
}

async function verifyOneBundlePath(
  bundleRoot: string,
  relativePath: string,
  expectedChecksum: string,
  expectedSizeBytes: number
): Promise<void> {
  const absolutePath = join(bundleRoot, relativePath)
  const actualStat = await stat(absolutePath)
  if (actualStat.size !== expectedSizeBytes) {
    throw new Error(`${relativePath}: size mismatch`)
  }
  const actualChecksum = await sha256File(absolutePath)
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`${relativePath}: checksum mismatch`)
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return `sha256:${hash.digest('hex')}`
}

function resolveImportPath(
  value: string,
  userId: number | undefined
): { path: string; ref: string | null } | null {
  if (isWebUploadRef(value)) {
    if (userId === undefined) return null
    const upload = resolveWebUploadRef(value, userId)
    return upload === null ? null : { path: upload.storedPath, ref: upload.ref }
  }

  if (serverPathImportDisabled() || !isAbsolute(value)) return null
  return { path: value, ref: null }
}

function resolveFilterUploadRefs(
  filters: unknown,
  userId: number | undefined
): Record<string, unknown> | undefined | null {
  if (filters === undefined || filters === null) return undefined
  if (typeof filters !== 'object') return filters as Record<string, unknown>
  const raw = filters as Record<string, unknown>
  if (typeof raw.bedFile !== 'string' || !isWebUploadRef(raw.bedFile)) return raw
  if (userId === undefined) return null
  const resolved = resolveWebUploadPath(raw.bedFile, userId)
  if (resolved === null) return null
  return { ...raw, bedFile: resolved }
}
