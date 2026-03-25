import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

// ============================================================
// Inline Zod Schemas for Case Metadata
// ============================================================

const CohortIdSchema = z.number().int().positive()

const MetadataUpsertSchema = z.object({
  affected_status: z.string().nullish(),
  sex: z.string().nullish(),
  notes: z.string().nullish()
})

const CohortCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullish()
})

const CohortUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullish()
})

const CohortNameSchema = z.string().min(1).max(200)

const CaseCohortAssignSchema = z.object({
  caseId: CaseIdSchema,
  cohortId: CohortIdSchema
})

const CaseSetCohortsSchema = z.object({
  caseId: CaseIdSchema,
  cohortIds: z.array(z.number().int().positive())
})

const HpoTermAssignSchema = z.object({
  caseId: CaseIdSchema,
  hpoId: z.string().min(1),
  hpoLabel: z.string().min(1)
})

const HpoTermRemoveSchema = z.object({
  caseId: CaseIdSchema,
  hpoId: z.string().min(1)
})

const DataInfoUpsertSchema = z.object({
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

const ExternalIdUpsertSchema = z.object({
  caseId: CaseIdSchema,
  idType: z.string().min(1),
  idValue: z.string().min(1)
})

const ExternalIdDeleteSchema = z.object({
  caseId: CaseIdSchema,
  idType: z.string().min(1)
})

/**
 * Case Metadata IPC handlers
 *
 * Channels: case-metadata:get, case-metadata:upsert, case-metadata:listCohorts,
 *           case-metadata:createCohort, case-metadata:updateCohort, case-metadata:deleteCohort, case-metadata:getCohortByName,
 *           case-metadata:getCaseCohorts, case-metadata:assignCohort, case-metadata:removeCohort,
 *           case-metadata:setCohorts, case-metadata:getHpoTerms, case-metadata:assignHpoTerm,
 *           case-metadata:removeHpoTerm, case-metadata:getFullMetadata
 */
export function registerCaseMetadataHandlers({
  ipcMain,
  getDb,
  getDbPool
}: HandlerDependencies): void {
  // ============================================================
  // Case Metadata Handlers
  // ============================================================

  /**
   * Get case metadata
   */
  ipcMain.handle('case-metadata:get', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:get params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'case-metadata:get', params: [validated.data] })
      }

      const db = getDb()
      return db.metadata.getCaseMetadata(validated.data)
    })
  })

  /**
   * Upsert case metadata
   */
  ipcMain.handle('case-metadata:upsert', async (_event, caseId: unknown, updates: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validatedId = CaseIdSchema.safeParse(caseId)
      if (!validatedId.success) {
        mainLogger.error(
          `Invalid case-metadata:upsert caseId: ${validatedId.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const validatedUpdates = MetadataUpsertSchema.safeParse(updates)
      if (!validatedUpdates.success) {
        mainLogger.error(
          `Invalid case-metadata:upsert updates: ${validatedUpdates.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      return db.metadata.upsertCaseMetadata(validatedId.data, validatedUpdates.data)
    })
  })

  // ============================================================
  // Cohort Group Handlers
  // ============================================================

  /**
   * List all cohort groups
   */
  ipcMain.handle('case-metadata:listCohorts', async () => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'case-metadata:listCohorts', params: [] })
      }

      const db = getDb()
      return db.metadata.listCohortGroups()
    })
  })

  /**
   * Create a new cohort group
   */
  ipcMain.handle(
    'case-metadata:createCohort',
    async (_event, name: unknown, description?: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CohortCreateSchema.safeParse({ name, description })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:createCohort params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const db = getDb()
        return db.metadata.createCohortGroup(validated.data.name, validated.data.description)
      })
    }
  )

  /**
   * Update a cohort group
   */
  ipcMain.handle(
    'case-metadata:updateCohort',
    async (_event, cohortId: unknown, updates: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedId = CohortIdSchema.safeParse(cohortId)
        if (!validatedId.success) {
          mainLogger.error(
            `Invalid case-metadata:updateCohort cohortId: ${validatedId.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const validatedUpdates = CohortUpdateSchema.safeParse(updates)
        if (!validatedUpdates.success) {
          mainLogger.error(
            `Invalid case-metadata:updateCohort updates: ${validatedUpdates.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const db = getDb()
        return db.metadata.updateCohortGroup(validatedId.data, validatedUpdates.data)
      })
    }
  )

  /**
   * Delete a cohort group
   */
  ipcMain.handle('case-metadata:deleteCohort', async (_event, cohortId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validatedId = CohortIdSchema.safeParse(cohortId)
      if (!validatedId.success) {
        mainLogger.error(
          `Invalid case-metadata:deleteCohort cohortId: ${validatedId.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      db.metadata.deleteCohortGroup(validatedId.data)
      return undefined
    })
  })

  /**
   * Get cohort group by name
   */
  ipcMain.handle('case-metadata:getCohortByName', async (_event, name: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CohortNameSchema.safeParse(name)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:getCohortByName params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'case-metadata:getCohortByName', params: [validated.data] })
      }

      const db = getDb()
      return db.metadata.getCohortGroupByName(validated.data)
    })
  })

  // ============================================================
  // Case-Cohort Link Handlers
  // ============================================================

  /**
   * Get all cohorts for a case
   */
  ipcMain.handle('case-metadata:getCaseCohorts', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:getCaseCohorts params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'case-metadata:getCaseCohorts', params: [validated.data] })
      }

      const db = getDb()
      return db.metadata.getCaseCohorts(validated.data)
    })
  })

  /**
   * Assign a case to a cohort
   */
  ipcMain.handle(
    'case-metadata:assignCohort',
    async (_event, caseId: unknown, cohortId: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CaseCohortAssignSchema.safeParse({ caseId, cohortId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:assignCohort params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const db = getDb()
        db.metadata.assignCaseCohort(validated.data.caseId, validated.data.cohortId)
        return undefined
      })
    }
  )

  /**
   * Remove a case from a cohort
   */
  ipcMain.handle(
    'case-metadata:removeCohort',
    async (_event, caseId: unknown, cohortId: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CaseCohortAssignSchema.safeParse({ caseId, cohortId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:removeCohort params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const db = getDb()
        db.metadata.removeCaseCohort(validated.data.caseId, validated.data.cohortId)
        return undefined
      })
    }
  )

  /**
   * Replace all cohort assignments for a case
   */
  ipcMain.handle(
    'case-metadata:setCohorts',
    async (_event, caseId: unknown, cohortIds: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CaseSetCohortsSchema.safeParse({ caseId, cohortIds })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:setCohorts params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const db = getDb()
        db.metadata.setCaseCohorts(validated.data.caseId, validated.data.cohortIds)
        return undefined
      })
    }
  )

  // ============================================================
  // HPO Term Handlers
  // ============================================================

  /**
   * Get all HPO terms for a case
   */
  ipcMain.handle('case-metadata:getHpoTerms', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:getHpoTerms params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'case-metadata:getHpoTerms', params: [validated.data] })
      }

      const db = getDb()
      return db.metadata.getCaseHpoTerms(validated.data)
    })
  })

  /**
   * Assign HPO term to case
   */
  ipcMain.handle(
    'case-metadata:assignHpoTerm',
    async (_event, caseId: unknown, hpoId: unknown, hpoLabel: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = HpoTermAssignSchema.safeParse({ caseId, hpoId, hpoLabel })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:assignHpoTerm params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const db = getDb()
        return db.metadata.assignCaseHpoTerm(
          validated.data.caseId,
          validated.data.hpoId,
          validated.data.hpoLabel
        )
      })
    }
  )

  /**
   * Remove HPO term from case
   */
  ipcMain.handle('case-metadata:removeHpoTerm', async (_event, caseId: unknown, hpoId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = HpoTermRemoveSchema.safeParse({ caseId, hpoId })
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:removeHpoTerm params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      db.metadata.removeCaseHpoTerm(validated.data.caseId, validated.data.hpoId)
      return undefined
    })
  })

  // ============================================================
  // Case Data Info Handlers
  // ============================================================

  /**
   * Get case data info (import provenance, platform, pre-filtering)
   */
  ipcMain.handle('case-metadata:getDataInfo', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:getDataInfo params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'case-metadata:getDataInfo', params: [validated.data] })
      }

      const db = getDb()
      return db.metadata.getCaseDataInfo(validated.data)
    })
  })

  /**
   * Upsert case data info
   */
  ipcMain.handle(
    'case-metadata:upsertDataInfo',
    async (_event, caseId: unknown, updates: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedId = CaseIdSchema.safeParse(caseId)
        if (!validatedId.success) {
          mainLogger.error(
            `Invalid case-metadata:upsertDataInfo caseId: ${validatedId.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const validatedUpdates = DataInfoUpsertSchema.safeParse(updates)
        if (!validatedUpdates.success) {
          mainLogger.error(
            `Invalid case-metadata:upsertDataInfo updates: ${validatedUpdates.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const db = getDb()
        return db.metadata.upsertCaseDataInfo(validatedId.data, validatedUpdates.data)
      })
    }
  )

  // ============================================================
  // Case External IDs Handlers
  // ============================================================

  ipcMain.handle('case-metadata:listExternalIds', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:listExternalIds params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'case-metadata:listExternalIds', params: [validated.data] })
      }

      const db = getDb()
      return db.metadata.listCaseExternalIds(validated.data)
    })
  })

  ipcMain.handle(
    'case-metadata:upsertExternalId',
    async (_event, caseId: unknown, idType: unknown, idValue: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = ExternalIdUpsertSchema.safeParse({ caseId, idType, idValue })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:upsertExternalId params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const db = getDb()
        return db.metadata.upsertCaseExternalId(
          validated.data.caseId,
          validated.data.idType,
          validated.data.idValue
        )
      })
    }
  )

  ipcMain.handle('case-metadata:distinctPlatforms', async () => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'case-metadata:distinctPlatforms', params: [] })
      }

      const db = getDb()
      return db.metadata.getDistinctPlatforms()
    })
  })

  ipcMain.handle('case-metadata:distinctExternalIdTypes', async () => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'case-metadata:distinctExternalIdTypes', params: [] })
      }

      const db = getDb()
      return db.metadata.getDistinctExternalIdTypes()
    })
  })

  ipcMain.handle(
    'case-metadata:deleteExternalId',
    async (_event, caseId: unknown, idType: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = ExternalIdDeleteSchema.safeParse({ caseId, idType })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:deleteExternalId params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const db = getDb()
        db.metadata.deleteCaseExternalId(validated.data.caseId, validated.data.idType)
        return undefined
      })
    }
  )

  // ============================================================
  // Convenience Handlers
  // ============================================================

  /**
   * Get full metadata for a case (metadata + cohorts + HPO terms)
   */
  ipcMain.handle('case-metadata:getFullMetadata', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:getFullMetadata params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'case-metadata:getFullMetadata', params: [validated.data] })
      }

      const db = getDb()
      return {
        metadata: db.metadata.getCaseMetadata(validated.data),
        cohorts: db.metadata.getCaseCohorts(validated.data),
        hpoTerms: db.metadata.getCaseHpoTerms(validated.data),
        comments: db.metadata.listCaseComments(validated.data),
        metrics: db.metadata.listCaseMetrics(validated.data),
        dataInfo: db.metadata.getCaseDataInfo(validated.data),
        externalIds: db.metadata.listCaseExternalIds(validated.data)
      }
    })
  })
}
