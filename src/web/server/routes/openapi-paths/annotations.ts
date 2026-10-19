import {
  AnnotationInvokeBodySchemas,
  AnnotationUnknownResponseSchema
} from '../../../../shared/api/schemas/annotations'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildAnnotationOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/annotations/getGlobal': dispatcherMethodOperation({
      tag: 'annotations',
      summary: 'Return the global annotation for a variant',
      body: AnnotationInvokeBodySchemas.getGlobal,
      response: AnnotationUnknownResponseSchema
    }),
    '/api/annotations/upsertGlobal': dispatcherMethodOperation({
      tag: 'annotations',
      summary: 'Create or update the global annotation for a variant',
      body: AnnotationInvokeBodySchemas.upsertGlobal,
      response: AnnotationUnknownResponseSchema
    }),
    '/api/annotations/upsertPerCase': dispatcherMethodOperation({
      tag: 'annotations',
      summary: 'Create or update a case-specific variant annotation',
      body: AnnotationInvokeBodySchemas.upsertPerCase,
      response: AnnotationUnknownResponseSchema
    }),
    '/api/annotations/batchUpsertPerCase': dispatcherMethodOperation({
      tag: 'annotations',
      summary: 'Batch create or update case-specific variant annotations',
      body: AnnotationInvokeBodySchemas.batchUpsertPerCase,
      response: AnnotationUnknownResponseSchema
    }),
    '/api/annotations/getForVariant': dispatcherMethodOperation({
      tag: 'annotations',
      summary: 'Return global and case-specific annotations for a variant',
      body: AnnotationInvokeBodySchemas.getForVariant,
      response: AnnotationUnknownResponseSchema
    })
  }
}
