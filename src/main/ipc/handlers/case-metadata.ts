import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'

/**
 * Case Metadata IPC handlers
 *
 * Channels: case-metadata:get, case-metadata:upsert, case-metadata:listCohorts,
 *           case-metadata:createCohort, case-metadata:deleteCohort, case-metadata:getCohortByName,
 *           case-metadata:getCaseCohorts, case-metadata:assignCohort, case-metadata:removeCohort,
 *           case-metadata:setCohorts, case-metadata:getHpoTerms, case-metadata:assignHpoTerm,
 *           case-metadata:removeHpoTerm, case-metadata:getFullMetadata
 */

// ============================================================
// Case Metadata Handlers
// ============================================================

/**
 * Get case metadata
 */
ipcMain.handle('case-metadata:get', async (_event, caseId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.getCaseMetadata(caseId)
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
    updates: { affected_status?: string | null; notes?: string | null }
  ) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.upsertCaseMetadata(caseId, updates)
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
    const db = getDatabaseService()
    return db.listCohortGroups()
  })
})

/**
 * Create a new cohort group
 */
ipcMain.handle(
  'case-metadata:createCohort',
  async (_event, name: string, description?: string | null) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.createCohortGroup(name, description)
    })
  }
)

/**
 * Delete a cohort group
 */
ipcMain.handle('case-metadata:deleteCohort', async (_event, cohortId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.deleteCohortGroup(cohortId)
    return undefined
  })
})

/**
 * Get cohort group by name
 */
ipcMain.handle('case-metadata:getCohortByName', async (_event, name: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.getCohortGroupByName(name)
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
    const db = getDatabaseService()
    return db.getCaseCohorts(caseId)
  })
})

/**
 * Assign a case to a cohort
 */
ipcMain.handle('case-metadata:assignCohort', async (_event, caseId: number, cohortId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.assignCaseCohort(caseId, cohortId)
    return undefined
  })
})

/**
 * Remove a case from a cohort
 */
ipcMain.handle('case-metadata:removeCohort', async (_event, caseId: number, cohortId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.removeCaseCohort(caseId, cohortId)
    return undefined
  })
})

/**
 * Replace all cohort assignments for a case
 */
ipcMain.handle('case-metadata:setCohorts', async (_event, caseId: number, cohortIds: number[]) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.setCaseCohorts(caseId, cohortIds)
    return undefined
  })
})

// ============================================================
// HPO Term Handlers
// ============================================================

/**
 * Get all HPO terms for a case
 */
ipcMain.handle('case-metadata:getHpoTerms', async (_event, caseId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.getCaseHpoTerms(caseId)
  })
})

/**
 * Assign HPO term to case
 */
ipcMain.handle(
  'case-metadata:assignHpoTerm',
  async (_event, caseId: number, hpoId: string, hpoLabel: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.assignCaseHpoTerm(caseId, hpoId, hpoLabel)
    })
  }
)

/**
 * Remove HPO term from case
 */
ipcMain.handle('case-metadata:removeHpoTerm', async (_event, caseId: number, hpoId: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.removeCaseHpoTerm(caseId, hpoId)
    return undefined
  })
})

// ============================================================
// Convenience Handlers
// ============================================================

/**
 * Get full metadata for a case (metadata + cohorts + HPO terms)
 */
ipcMain.handle('case-metadata:getFullMetadata', async (_event, caseId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return {
      metadata: db.getCaseMetadata(caseId),
      cohorts: db.getCaseCohorts(caseId),
      hpoTerms: db.getCaseHpoTerms(caseId)
    }
  })
})
