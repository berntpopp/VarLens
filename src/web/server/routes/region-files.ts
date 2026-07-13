import { isAbsolute } from 'node:path'

import { RegionFileImportBedArgsSchema } from '../../../shared/api/schemas/region-files'
import { resolveMaxDecompressedBytes } from '../../../main/import/stream-utils'
import { MAX_BED_FILTER_DECOMPRESSED_BYTES } from '../../../main/import/vcf/bed-filter'
import { readBedEntries } from '../../../main/import/vcf/bed-reader'
import { serverPathImportDisabled, serverPathImportDisabledResponse } from './server-path-import'
import type { OverrideHandler } from './types'
import { isWebUploadRef, resolveWebUploadPath } from './upload-staging'

async function collectBedEntries(
  filePath: string
): Promise<Array<{ chr: string; start: number; end: number; label?: string }>> {
  const entries: Array<{ chr: string; start: number; end: number; label?: string }> = []
  const maxBytes = Math.min(resolveMaxDecompressedBytes(), MAX_BED_FILTER_DECOMPRESSED_BYTES)
  for await (const entry of readBedEntries(filePath, maxBytes, { rejectMalformedRows: true })) {
    entries.push(entry)
  }
  return entries
}

export function buildRegionFileOverrides(): Record<string, OverrideHandler> {
  return {
    'region-files:importBed': {
      async handle(args, request, reply, { session }) {
        const parsed = RegionFileImportBedArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-bed-import' }
        }
        const [fileId, filePath] = parsed.data

        const resolvedPath = resolveBedFilePath(filePath, request.session.user?.id)
        if (resolvedPath === null) {
          reply.code(isWebUploadRef(filePath) ? 404 : 403)
          return isWebUploadRef(filePath)
            ? { error: 'upload-not-found', message: 'Uploaded BED file is no longer available' }
            : serverPathImportDisabledResponse()
        }
        if (!isAbsolute(resolvedPath)) {
          reply.code(400)
          return { error: 'invalid-bed-import' }
        }
        return await session.getWriteExecutor().execute({
          type: 'region-files:importBed',
          params: [fileId, await collectBedEntries(resolvedPath)]
        })
      }
    }
  }
}

function resolveBedFilePath(filePath: string, userId: number | undefined): string | null {
  if (isWebUploadRef(filePath)) {
    if (userId === undefined) return null
    return resolveWebUploadPath(filePath, userId)
  }
  if (serverPathImportDisabled()) return null
  return filePath
}
