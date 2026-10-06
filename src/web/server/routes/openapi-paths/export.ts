import {
  ExportInvokeBodySchemas,
  ExportUnknownResponseSchema,
  PrepareDownloadResponseSchema
} from '../../../../shared/api/schemas/export'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildExportOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/export/variants': dispatcherMethodOperation({
      tag: 'export',
      summary: 'Export variants for a case',
      body: ExportInvokeBodySchemas.variants,
      response: ExportUnknownResponseSchema,
      mayReturnUnsupported: true
    }),
    '/api/export/cohort': dispatcherMethodOperation({
      tag: 'export',
      summary: 'Export cohort variants',
      body: ExportInvokeBodySchemas.cohort,
      response: ExportUnknownResponseSchema,
      mayReturnUnsupported: true
    }),
    '/api/export/prepareDownload': dispatcherMethodOperation({
      tag: 'export',
      summary:
        'Prepare a variants / cohort (CSV or XLSX) or panel BED export; returns a ' +
        'single-use, 60 s, user-bound path for GET /api/download/{token} (analyst+)',
      body: ExportInvokeBodySchemas.prepareDownload,
      response: PrepareDownloadResponseSchema,
      forbiddenDescription: 'The session role is below analyst'
    })
  }
}
