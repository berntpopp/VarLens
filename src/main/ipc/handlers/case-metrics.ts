import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

// ============================================================
// Inline Zod Schemas for Case Metrics
// ============================================================

const MetricIdSchema = z.number().int().positive()

const MetricDefinitionCreateSchema = z.object({
  name: z.string().min(1).max(200),
  valueType: z.enum(['numeric', 'text', 'date']),
  unit: z.string(),
  category: z.string().min(1)
})

const MetricValueSchema = z.object({
  numeric_value: z.number().nullish(),
  text_value: z.string().nullish(),
  date_value: z.string().nullish()
})

const MetricUpsertSchema = z.object({
  caseId: CaseIdSchema,
  metricId: MetricIdSchema,
  value: MetricValueSchema
})

const MetricDeleteSchema = z.object({
  caseId: CaseIdSchema,
  metricId: MetricIdSchema
})

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

        const db = getDb()
        return db.metadata.createMetricDefinition(
          validated.data.name,
          validated.data.valueType,
          validated.data.unit,
          validated.data.category
        )
      })
    }
  )

  ipcMain.handle('case-metrics:listForCase', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metrics:listForCase params: ${validated.error.message}`,
          'case-metrics'
        )
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      return db.metadata.listCaseMetrics(validated.data)
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

        const db = getDb()
        return db.metadata.upsertCaseMetric(
          validated.data.caseId,
          validated.data.metricId,
          validated.data.value
        )
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

      const db = getDb()
      db.metadata.deleteCaseMetric(validated.data.caseId, validated.data.metricId)
      return undefined
    })
  })
}
