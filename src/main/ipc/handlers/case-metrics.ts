import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'

/**
 * Case Metrics IPC handlers
 *
 * Channels: case-metrics:listDefinitions, case-metrics:createDefinition,
 *           case-metrics:listForCase, case-metrics:upsert, case-metrics:delete
 */
export function registerCaseMetricHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('case-metrics:listDefinitions', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.listMetricDefinitions()
    })
  })

  ipcMain.handle(
    'case-metrics:createDefinition',
    async (
      _event,
      name: string,
      valueType: 'numeric' | 'text' | 'date',
      unit: string,
      category: string
    ) => {
      return wrapHandler(async () => {
        const db = getDb()
        return db.metadata.createMetricDefinition(name, valueType, unit, category)
      })
    }
  )

  ipcMain.handle('case-metrics:listForCase', async (_event, caseId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.metadata.listCaseMetrics(caseId)
    })
  })

  ipcMain.handle(
    'case-metrics:upsert',
    async (
      _event,
      caseId: number,
      metricId: number,
      value: {
        numeric_value?: number | null
        text_value?: string | null
        date_value?: string | null
      }
    ) => {
      return wrapHandler(async () => {
        const db = getDb()
        return db.metadata.upsertCaseMetric(caseId, metricId, value)
      })
    }
  )

  ipcMain.handle('case-metrics:delete', async (_event, caseId: number, metricId: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      db.metadata.deleteCaseMetric(caseId, metricId)
      return undefined
    })
  })
}
