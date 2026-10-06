import {
  CohortInvokeBodySchemas,
  CohortSummaryStatusSchema,
  CohortUnknownResponseSchema
} from '../../../../shared/api/schemas/cohort'
import {
  dispatcherMethodOperation,
  unsupportedDispatcherMethodOperation,
  type OpenApiPathItem
} from '../openapi-utils'

export function buildCohortOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/cohort/getVariants': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Query cohort variants',
      body: CohortInvokeBodySchemas.getVariants,
      response: CohortUnknownResponseSchema
    }),
    '/api/cohort/getColumnMeta': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Return cohort column metadata',
      body: CohortInvokeBodySchemas.empty,
      response: CohortUnknownResponseSchema
    }),
    '/api/cohort/getSummary': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Return cohort summary',
      body: CohortInvokeBodySchemas.empty,
      response: CohortUnknownResponseSchema
    }),
    '/api/cohort/getSummaryStatus': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Return cohort summary rebuild status',
      body: CohortInvokeBodySchemas.empty,
      response: CohortSummaryStatusSchema
    }),
    '/api/cohort/runAssociation': unsupportedDispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Run cohort association analysis',
      body: CohortInvokeBodySchemas.unsupported
    }),
    '/api/cohort/cancelAssociation': unsupportedDispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Cancel cohort association analysis',
      body: CohortInvokeBodySchemas.unsupported
    }),
    '/api/cohort/getCarriers': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Return carriers for a cohort variant coordinate',
      body: CohortInvokeBodySchemas.getCarriers,
      response: CohortUnknownResponseSchema
    }),
    '/api/cohort/getGeneBurden': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Return cohort gene burden summary',
      body: CohortInvokeBodySchemas.empty,
      response: CohortUnknownResponseSchema
    })
  }
}
