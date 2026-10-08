import { z } from 'zod'

import { CohortSearchParamsSchema } from '../../types/ipc-schemas'

export { CohortSearchParamsSchema }

/** The six-field identity of one cohort row. Nothing is optional, nothing defaults (#503). */
export const CohortCarriersParamsSchema = z.object({
  chr: z.string().min(1),
  pos: z.number().int().positive(),
  ref: z.string().min(1),
  alt: z.string().min(1),
  variant_type: z.string().min(1),
  genome_build: z.string().min(1)
})

const CohortSearchOpenApiSchema = z.record(z.string(), z.unknown())

export const CohortInvokeBodySchemas = {
  getVariants: z.object({
    args: z.tuple([CohortSearchOpenApiSchema])
  }),
  empty: z.object({
    args: z.tuple([])
  }),
  getCarriers: z.object({
    args: z.tuple([CohortCarriersParamsSchema])
  }),
  unsupported: z.object({
    args: z.array(z.unknown()).optional()
  })
} as const

export const CohortSummaryStatusSchema = z.object({
  is_stale: z.boolean(),
  last_rebuilt_at: z.number()
})

export const CohortUnknownResponseSchema = z.unknown()

export type CohortCarriersParams = z.infer<typeof CohortCarriersParamsSchema>
