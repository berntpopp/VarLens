import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  AnalysisGroupCreateSchema,
  AnalysisGroupUpdateSchema,
  AnalysisGroupMemberAddSchema,
  CaseIdSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import { z } from 'zod'

const GroupIdSchema = z.number().int().positive()

/**
 * Analysis Groups IPC handlers
 *
 * Channels: analysisGroups:list, analysisGroups:get, analysisGroups:create,
 *           analysisGroups:update, analysisGroups:delete, analysisGroups:addMember,
 *           analysisGroups:removeMember, analysisGroups:getForCase
 */
export function registerAnalysisGroupHandlers({
  ipcMain,
  getDb,
  getDbManager
}: HandlerDependencies): void {
  /**
   * List all analysis groups
   */
  ipcMain.handle('analysisGroups:list', async () => {
    return wrapHandler(async () => {
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({ type: 'analysis-groups:list', params: [] })
      }
      return getDb().analysisGroups.listGroups()
    })
  })

  /**
   * Get a single analysis group with its members
   */
  ipcMain.handle('analysisGroups:get', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validated = GroupIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(
          `Invalid analysisGroups:get id: ${validated.error.message}`,
          'analysisGroups'
        )
        throw new Error('Invalid group ID')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session
          .getReadExecutor()
          .execute({ type: 'analysis-groups:get', params: [validated.data] })
      }
      return getDb().analysisGroups.getGroupWithMembers(validated.data)
    })
  })

  /**
   * Create a new analysis group
   */
  ipcMain.handle('analysisGroups:create', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = AnalysisGroupCreateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid analysisGroups:create params: ${validated.error.message}`,
          'analysisGroups'
        )
        throw new Error('Invalid group parameters')
      }
      const session = getDbManager().getCurrentSession()
      return await session.getWriteExecutor().execute({
        type: 'analysis-groups:create',
        params: [validated.data.name, validated.data.groupType, validated.data.description]
      })
    })
  })

  /**
   * Update an existing analysis group
   */
  ipcMain.handle('analysisGroups:update', async (_event, id: unknown, params: unknown) => {
    return wrapHandler(async () => {
      const validatedId = GroupIdSchema.safeParse(id)
      if (!validatedId.success) {
        mainLogger.error(
          `Invalid analysisGroups:update id: ${validatedId.error.message}`,
          'analysisGroups'
        )
        throw new Error('Invalid group ID')
      }
      const validatedParams = AnalysisGroupUpdateSchema.safeParse(params)
      if (!validatedParams.success) {
        mainLogger.error(
          `Invalid analysisGroups:update params: ${validatedParams.error.message}`,
          'analysisGroups'
        )
        throw new Error('Invalid update parameters')
      }
      const session = getDbManager().getCurrentSession()
      return await session.getWriteExecutor().execute({
        type: 'analysis-groups:update',
        params: [validatedId.data, validatedParams.data]
      })
    })
  })

  /**
   * Delete an analysis group
   */
  ipcMain.handle('analysisGroups:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validated = GroupIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(
          `Invalid analysisGroups:delete id: ${validated.error.message}`,
          'analysisGroups'
        )
        throw new Error('Invalid group ID')
      }
      const session = getDbManager().getCurrentSession()
      await session
        .getWriteExecutor()
        .execute({ type: 'analysis-groups:delete', params: [validated.data] })
      return undefined
    })
  })

  /**
   * Add a member (case) to an analysis group
   */
  ipcMain.handle('analysisGroups:addMember', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = AnalysisGroupMemberAddSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid analysisGroups:addMember params: ${validated.error.message}`,
          'analysisGroups'
        )
        throw new Error('Invalid member parameters')
      }
      const session = getDbManager().getCurrentSession()
      return await session.getWriteExecutor().execute({
        type: 'analysis-groups:addMember',
        params: [
          validated.data.groupId,
          validated.data.caseId,
          validated.data.role,
          validated.data.affectedStatus,
          validated.data.individualId
        ]
      })
    })
  })

  /**
   * Remove a member (case) from an analysis group
   */
  ipcMain.handle(
    'analysisGroups:removeMember',
    async (_event, groupId: unknown, caseId: unknown) => {
      return wrapHandler(async () => {
        const vGroup = GroupIdSchema.safeParse(groupId)
        const vCase = CaseIdSchema.safeParse(caseId)
        if (!vGroup.success || !vCase.success) {
          mainLogger.error(`Invalid analysisGroups:removeMember params`, 'analysisGroups')
          throw new Error('Invalid parameters')
        }
        const session = getDbManager().getCurrentSession()
        await session.getWriteExecutor().execute({
          type: 'analysis-groups:removeMember',
          params: [vGroup.data, vCase.data]
        })
        return undefined
      })
    }
  )

  /**
   * Get the analysis group for a given case
   */
  ipcMain.handle('analysisGroups:getForCase', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid analysisGroups:getForCase caseId: ${validated.error.message}`,
          'analysisGroups'
        )
        throw new Error('Invalid case ID')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session
          .getReadExecutor()
          .execute({ type: 'analysis-groups:getForCase', params: [validated.data] })
      }
      return getDb().analysisGroups.getGroupForCase(validated.data)
    })
  })
}
