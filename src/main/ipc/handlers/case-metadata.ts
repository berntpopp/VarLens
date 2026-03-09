import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'

/**
 * Case Metadata IPC handlers
 *
 * Channels: case-metadata:get, case-metadata:upsert, case-metadata:listCohorts,
 *           case-metadata:createCohort, case-metadata:updateCohort, case-metadata:deleteCohort, case-metadata:getCohortByName,
 *           case-metadata:getCaseCohorts, case-metadata:assignCohort, case-metadata:removeCohort,
 *           case-metadata:setCohorts, case-metadata:getHpoTerms, case-metadata:assignHpoTerm,
 *           case-metadata:removeHpoTerm, case-metadata:getFullMetadata
 */
export function registerCaseMetadataHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  // ============================================================
  // Case Metadata Handlers
  // ============================================================

  /**
   * Get case metadata
   */
  ipcMain.handle('case-metadata:get', async (_event, caseId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.getCaseMetadata(caseId)
    })
  })

  /**
   * Upsert case metadata
   */
  ipcMain.handle(
    'case-metadata:upsert',
    async (
      _event,
      caseId: number,
      updates: { affected_status?: string | null; sex?: string | null; notes?: string | null }
    ) => {
      return wrapHandler(async () => {
        const db = getDb()
        return db.metadata.upsertCaseMetadata(caseId, updates)
      })
    }
  )

  // ============================================================
  // Cohort Group Handlers
  // ============================================================

  /**
   * List all cohort groups
   */
  ipcMain.handle('case-metadata:listCohorts', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.listCohortGroups()
    })
  })

  /**
   * Create a new cohort group
   */
  ipcMain.handle(
    'case-metadata:createCohort',
    async (_event, name: string, description?: string | null) => {
      return wrapHandler(async () => {
        const db = getDb()
        return db.metadata.createCohortGroup(name, description)
      })
    }
  )

  /**
   * Update a cohort group
   */
  ipcMain.handle(
    'case-metadata:updateCohort',
    async (_event, cohortId: number, updates: { name?: string; description?: string | null }) => {
      return wrapHandler(async () => {
        const db = getDb()
        return db.metadata.updateCohortGroup(cohortId, updates)
      })
    }
  )

  /**
   * Delete a cohort group
   */
  ipcMain.handle('case-metadata:deleteCohort', async (_event, cohortId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      db.metadata.deleteCohortGroup(cohortId)
      return undefined
    })
  })

  /**
   * Get cohort group by name
   */
  ipcMain.handle('case-metadata:getCohortByName', async (_event, name: string) => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.getCohortGroupByName(name)
    })
  })

  // ============================================================
  // Case-Cohort Link Handlers
  // ============================================================

  /**
   * Get all cohorts for a case
   */
  ipcMain.handle('case-metadata:getCaseCohorts', async (_event, caseId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.getCaseCohorts(caseId)
    })
  })

  /**
   * Assign a case to a cohort
   */
  ipcMain.handle('case-metadata:assignCohort', async (_event, caseId: number, cohortId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      db.metadata.assignCaseCohort(caseId, cohortId)
      return undefined
    })
  })

  /**
   * Remove a case from a cohort
   */
  ipcMain.handle('case-metadata:removeCohort', async (_event, caseId: number, cohortId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      db.metadata.removeCaseCohort(caseId, cohortId)
      return undefined
    })
  })

  /**
   * Replace all cohort assignments for a case
   */
  ipcMain.handle(
    'case-metadata:setCohorts',
    async (_event, caseId: number, cohortIds: number[]) => {
      return wrapHandler(async () => {
        const db = getDb()
        db.metadata.setCaseCohorts(caseId, cohortIds)
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
  ipcMain.handle('case-metadata:getHpoTerms', async (_event, caseId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.getCaseHpoTerms(caseId)
    })
  })

  /**
   * Assign HPO term to case
   */
  ipcMain.handle(
    'case-metadata:assignHpoTerm',
    async (_event, caseId: number, hpoId: string, hpoLabel: string) => {
      return wrapHandler(async () => {
        const db = getDb()
        return db.metadata.assignCaseHpoTerm(caseId, hpoId, hpoLabel)
      })
    }
  )

  /**
   * Remove HPO term from case
   */
  ipcMain.handle('case-metadata:removeHpoTerm', async (_event, caseId: number, hpoId: string) => {
    return wrapHandler(async () => {
      const db = getDb()
      db.metadata.removeCaseHpoTerm(caseId, hpoId)
      return undefined
    })
  })

  // ============================================================
  // Case Data Info Handlers
  // ============================================================

  /**
   * Get case data info (import provenance, platform, pre-filtering)
   */
  ipcMain.handle('case-metadata:getDataInfo', async (_event, caseId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.getCaseDataInfo(caseId)
    })
  })

  /**
   * Upsert case data info
   */
  ipcMain.handle(
    'case-metadata:upsertDataInfo',
    async (
      _event,
      caseId: number,
      updates: {
        platform?: string | null
        platform_details?: string | null
        af_filter?: string | null
        gene_list_filter?: string | null
        region_filter?: string | null
        quality_filter?: string | null
        data_notes?: string | null
        gene_list_id?: number | null
        region_file_id?: number | null
      }
    ) => {
      return wrapHandler(async () => {
        const db = getDb()
        return db.metadata.upsertCaseDataInfo(caseId, updates)
      })
    }
  )

  // ============================================================
  // Case External IDs Handlers
  // ============================================================

  ipcMain.handle('case-metadata:listExternalIds', async (_event, caseId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.listCaseExternalIds(caseId)
    })
  })

  ipcMain.handle(
    'case-metadata:upsertExternalId',
    async (_event, caseId: number, idType: string, idValue: string) => {
      return wrapHandler(async () => {
        const db = getDb()
        return db.metadata.upsertCaseExternalId(caseId, idType, idValue)
      })
    }
  )

  ipcMain.handle('case-metadata:distinctPlatforms', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.getDistinctPlatforms()
    })
  })

  ipcMain.handle('case-metadata:distinctExternalIdTypes', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.getDistinctExternalIdTypes()
    })
  })

  ipcMain.handle(
    'case-metadata:deleteExternalId',
    async (_event, caseId: number, idType: string) => {
      return wrapHandler(async () => {
        const db = getDb()
        db.metadata.deleteCaseExternalId(caseId, idType)
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
  ipcMain.handle('case-metadata:getFullMetadata', async (_event, caseId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      return {
        metadata: db.metadata.getCaseMetadata(caseId),
        cohorts: db.metadata.getCaseCohorts(caseId),
        hpoTerms: db.metadata.getCaseHpoTerms(caseId),
        comments: db.metadata.listCaseComments(caseId),
        metrics: db.metadata.listCaseMetrics(caseId),
        dataInfo: db.metadata.getCaseDataInfo(caseId),
        externalIds: db.metadata.listCaseExternalIds(caseId)
      }
    })
  })
}
