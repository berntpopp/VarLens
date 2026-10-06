import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  CaseMetricCaseIdSchema,
  MetricDefinitionCreateSchema,
  MetricDeleteSchema,
  MetricUpsertSchema
} from '../../../shared/api/schemas/case-metrics'
import { mainLogger } from '../../services/MainLogger'

/**
 * Case Metrics IPC handlers
 *
 * Channels: case-metrics:listDefinitions, case-metrics:createDefinition,
 *           case-metrics:listForCase, case-metrics:upsert, case-metrics:delete
 */
export function registerCaseMetricHandlers({
  ipcMain,
  getDb,
  getDbManager
}: HandlerDependencies): void {
  ipcMain.handle('case-metrics:listDefinitions', async () => {
    return wrapHandler(async () => {
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session
          .getReadExecutor()
          .execute({ type: 'case-metrics:listDefinitions', params: [] })
      }
      return getDb().metadata.listMetricDefinitions()
    })
  })

  ipcMain.handle(
    'case-metrics:createDefinition',
    async (_event, name: unknown, valueType: unknown, unit: unknown, category: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = MetricDefinitionCreateSchema.safeParse({
          name,
          valueType,
          unit,
          category
        })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metrics:createDefinition params: ${validated.error.message}`,
            'case-metrics'
          )
          throw new Error('Invalid parameters')
        }

        const session = getDbManager().getCurrentSession()
        return await session.getWriteExecutor().execute({
          type: 'case-metrics:createDefinition',
          params: [
            validated.data.name,
            validated.data.valueType,
            validated.data.unit,
            validated.data.category
          ]
        })
      })
    }
  )

  ipcMain.handle('case-metrics:listForCase', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseMetricCaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metrics:listForCase params: ${validated.error.message}`,
          'case-metrics'
        )
        throw new Error('Invalid parameters')
      }

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session
          .getReadExecutor()
          .execute({ type: 'case-metrics:listForCase', params: [validated.data] })
      }
      return getDb().metadata.listCaseMetrics(validated.data)
    })
  })

  ipcMain.handle(
    'case-metrics:upsert',
    async (_event, caseId: unknown, metricId: unknown, value: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = MetricUpsertSchema.safeParse({ caseId, metricId, value })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metrics:upsert params: ${validated.error.message}`,
            'case-metrics'
          )
          throw new Error('Invalid parameters')
        }

        const session = getDbManager().getCurrentSession()
        return await session.getWriteExecutor().execute({
          type: 'case-metrics:upsert',
          params: [validated.data.caseId, validated.data.metricId, validated.data.value]
        })
      })
    }
  )

  ipcMain.handle('case-metrics:delete', async (_event, caseId: unknown, metricId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = MetricDeleteSchema.safeParse({ caseId, metricId })
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metrics:delete params: ${validated.error.message}`,
          'case-metrics'
        )
        throw new Error('Invalid parameters')
      }

      const session = getDbManager().getCurrentSession()
      await session.getWriteExecutor().execute({
        type: 'case-metrics:delete',
        params: [validated.data.caseId, validated.data.metricId]
      })
      return undefined
    })
  })
}
