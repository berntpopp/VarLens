import {
  BatchImportInvokeBodySchemas,
  BatchImportUnknownResponseSchema
} from '../../../../shared/api/schemas/batch-import'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildBatchImportOpenApiPaths(): Record<string, OpenApiPathItem> {
  const forbiddenDescription = 'Forbidden or server-path import disabled'

  return {
    '/api/batch-import/extractZip': dispatcherMethodOperation({
      tag: 'batch-import',
      summary: 'Extract a server-side ZIP archive for batch import',
      body: BatchImportInvokeBodySchemas.extractZip,
      response: BatchImportUnknownResponseSchema,
      forbiddenDescription
    }),
    '/api/batch-import/status': dispatcherMethodOperation({
      tag: 'batch-import',
      summary: 'Report whether a batch import run is running, completed or failed, with its result',
      body: BatchImportInvokeBodySchemas.status,
      response: BatchImportUnknownResponseSchema
    }),
    '/api/batch-import/inspectZip': dispatcherMethodOperation({
      tag: 'batch-import',
      summary: 'Report whether an uploaded ZIP archive has encrypted entries',
      body: BatchImportInvokeBodySchemas.inspectZip,
      response: BatchImportUnknownResponseSchema
    }),
    '/api/batch-import/testZipPassword': dispatcherMethodOperation({
      tag: 'batch-import',
      summary: 'Test a server-side ZIP archive password',
      body: BatchImportInvokeBodySchemas.testZipPassword,
      response: BatchImportUnknownResponseSchema,
      forbiddenDescription
    }),
    '/api/batch-import/cleanupZipTemp': dispatcherMethodOperation({
      tag: 'batch-import',
      summary: 'Remove temporary files created during ZIP import',
      body: BatchImportInvokeBodySchemas.cleanupZipTemp,
      response: BatchImportUnknownResponseSchema
    })
  }
}
