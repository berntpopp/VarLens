import { z } from 'zod'

import { CaseIdSchema } from '../../types/ipc-schemas'

// Argument schemas shared by the desktop IPC handlers and the web dispatcher.
export const CohortIdSchema = z.number().int().positive()

export const MetadataUpsertSchema = z.object({
  affected_status: z.string().nullish(),
  sex: z.string().nullish(),
  notes: z.string().nullish(),
  age: z.number().nullish(),
  date_of_birth: z.string().nullish()
})

export const CohortCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullish()
})

export const CohortUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullish()
})

export const CohortNameSchema = z.string().min(1).max(200)

export const CaseCohortAssignSchema = z.object({
  caseId: CaseIdSchema,
  cohortId: CohortIdSchema
})

export const CaseSetCohortsSchema = z.object({
  caseId: CaseIdSchema,
  cohortIds: z.array(z.number().int().positive())
})

export const HpoTermAssignSchema = z.object({
  caseId: CaseIdSchema,
  hpoId: z.string().min(1),
  hpoLabel: z.string().min(1)
})

export const HpoTermRemoveSchema = z.object({
  caseId: CaseIdSchema,
  hpoId: z.string().min(1)
})

export const DataInfoUpsertSchema = z.object({
  platform: z.string().nullish(),
  platform_details: z.string().nullish(),
  af_filter: z.string().nullish(),
  gene_list_filter: z.string().nullish(),
  region_filter: z.string().nullish(),
  quality_filter: z.string().nullish(),
  data_notes: z.string().nullish(),
  gene_list_id: z.number().int().positive().nullish(),
  region_file_id: z.number().int().positive().nullish()
})

export const ExternalIdUpsertSchema = z.object({
  caseId: CaseIdSchema,
  idType: z.string().min(1),
  idValue: z.string().min(1)
})

export const ExternalIdDeleteSchema = z.object({
  caseId: CaseIdSchema,
  idType: z.string().min(1)
})

export const CaseMetadataCohortCreateArgsSchema = z
  .tuple([z.string(), z.unknown().optional()])
  .rest(z.unknown())

export const CaseMetadataInvokeBodySchemas = {
  createCohort: z.object({
    args: CaseMetadataCohortCreateArgsSchema
  })
} as const

export const CaseMetadataUnknownResponseSchema = z.unknown()
