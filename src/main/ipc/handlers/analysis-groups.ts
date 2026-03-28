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
export function registerAnalysisGroupHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  /**
   * List all analysis groups
   */
  ipcMain.handle('analysisGroups:list', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.analysisGroups.listGroups()
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
      const db = getDb()
      return db.analysisGroups.getGroupWithMembers(validated.data)
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
      const db = getDb()
      return db.analysisGroups.createGroup(
        validated.data.name,
        validated.data.groupType,
        validated.data.description
      )
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
      const db = getDb()
      return db.analysisGroups.updateGroup(validatedId.data, validatedParams.data)
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
      const db = getDb()
      db.analysisGroups.deleteGroup(validated.data)
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
      const db = getDb()
      return db.analysisGroups.addMember(
        validated.data.groupId,
        validated.data.caseId,
        validated.data.role,
        validated.data.affectedStatus,
        validated.data.individualId
      )
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
        const db = getDb()
        db.analysisGroups.removeMember(vGroup.data, vCase.data)
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
      const db = getDb()
      return db.analysisGroups.getGroupForCase(validated.data)
    })
  })
}
