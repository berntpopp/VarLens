import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import { CohortService } from '../../database/cohort'
import type { CohortSearchParams } from '../../../shared/types/cohort'

/**
 * Cohort IPC handlers
 * Channels: cohort:variants, cohort:summary
 */

ipcMain.handle('cohort:variants', async (_event, params: CohortSearchParams) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const cohortService = new CohortService(db.database)
    return cohortService.getCohortVariants(params)
  })
})

ipcMain.handle('cohort:summary', async (_event) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const cohortService = new CohortService(db.database)
    return cohortService.getCohortSummary()
  })
})
