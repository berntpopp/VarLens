import { z } from 'zod'
import type { JobKind, JobStatus } from '../../types/jobs'

/**
 * `jobs:*` IPC payload schemas. Job ids are in-memory JobRunner Map keys
 * (ULID-style strings, see src/main/services/jobs/JobRunner.ts), but the
 * repo convention is to validate every IPC arg at the boundary regardless
 * of the trust level of the eventual lookup.
 */
const JobIdSchema = z.string().trim().min(1).max(64)

/** Keep in sync with `JobKind` in src/shared/types/jobs.ts. */
const JobKindSchema: z.ZodType<JobKind> = z.enum([
  'import_single',
  'import_batch',
  'cohort_rebuild',
  'association',
  'export'
])

/** Keep in sync with `JobStatus` in src/shared/types/jobs.ts. */
const JobStatusSchema: z.ZodType<JobStatus> = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled'
])

const JobsFilterSchema = z
  .object({
    kind: JobKindSchema.optional(),
    status: JobStatusSchema.optional()
  })
  .strict()
  .optional()

export const JobsListParamsSchema = z.tuple([JobsFilterSchema])
export const JobsGetParamsSchema = z.tuple([JobIdSchema])
export const JobsProgressParamsSchema = z.tuple([JobIdSchema])
