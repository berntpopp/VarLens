import {
  DatabaseInfoSchema,
  DatabaseInvokeBodySchemas,
  DatabaseUnknownResponseSchema
} from '../../../../shared/api/schemas/database'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildDatabaseOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/database/capabilities': dispatcherMethodOperation({
      tag: 'database',
      summary: 'Return web database capabilities',
      body: DatabaseInvokeBodySchemas.empty,
      response: DatabaseUnknownResponseSchema
    }),
    '/api/database/health': dispatcherMethodOperation({
      tag: 'database',
      summary: 'Return database health',
      body: DatabaseInvokeBodySchemas.empty,
      response: DatabaseUnknownResponseSchema
    }),
    '/api/database/info': dispatcherMethodOperation({
      tag: 'database',
      summary: 'Return current web database identity',
      body: DatabaseInvokeBodySchemas.empty,
      response: DatabaseInfoSchema
    }),
    '/api/database/getOverview': dispatcherMethodOperation({
      tag: 'database',
      summary: 'Return database overview',
      body: DatabaseInvokeBodySchemas.empty,
      response: DatabaseUnknownResponseSchema
    })
  }
}
