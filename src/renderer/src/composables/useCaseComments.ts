/**
 * Composable for case comment state management
 *
 * Provides reactive comment state per case with IPC-backed persistence.
 * Used by CaseCommentsTab for comment CRUD.
 */

import type { CaseComment, CommentCategory } from '../../../shared/types/api'
import { useApiService } from './useApiService'
import { logService } from '../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import { createPerCaseCache } from './per-case-cache'
import {
  mdiCalendarCheck,
  mdiFamilyTree,
  mdiFlask,
  mdiLightbulbOutline,
  mdiPill,
  mdiStethoscope
} from '@mdi/js'

// Comments by caseId — bounded LRU. Lists are replaced, never mutated in place.
const commentsCache = createPerCaseCache<CaseComment[]>()

export const COMMENT_CATEGORIES: CommentCategory[] = [
  'Clinical Note',
  'Lab Result',
  'Interpretation',
  'Follow-up',
  'Family History',
  'Treatment'
]

export const COMMENT_CATEGORY_ICONS: Record<CommentCategory, string> = {
  'Clinical Note': mdiStethoscope,
  'Lab Result': mdiFlask,
  Interpretation: mdiLightbulbOutline,
  'Follow-up': mdiCalendarCheck,
  'Family History': mdiFamilyTree,
  Treatment: mdiPill
}

export const COMMENT_CATEGORY_COLORS: Record<CommentCategory, string> = {
  'Clinical Note': 'primary',
  'Lab Result': 'info',
  Interpretation: 'warning',
  'Follow-up': 'success',
  'Family History': 'purple',
  Treatment: 'teal'
}

export function useCaseComments() {
  const { api } = useApiService()

  async function loadComments(caseId: number): Promise<void> {
    if (!api) return
    try {
      await commentsCache.load(caseId, async () =>
        unwrapIpcResult(await api.caseComments.list(caseId))
      )
    } catch (error) {
      logService.error(
        'Failed to load comments: ' +
          (error instanceof Error
            ? error.message
            : isIpcError(error)
              ? (error.userMessage ?? error.message)
              : String(error)),
        'comments'
      )
    }
  }

  function getComments(caseId: number): CaseComment[] {
    return commentsCache.get(caseId) ?? []
  }

  function isLoading(caseId: number): boolean {
    return commentsCache.isLoading(caseId)
  }

  async function createComment(
    caseId: number,
    category: CommentCategory,
    content: string
  ): Promise<CaseComment | null> {
    if (!api) return null
    const comment = unwrapIpcResult(await api.caseComments.create(caseId, category, content))

    // Add to cache (newest first)
    commentsCache.set(caseId, [comment, ...(commentsCache.get(caseId) ?? [])])

    return comment
  }

  async function updateComment(caseId: number, commentId: number, content: string): Promise<void> {
    if (!api) return
    const updated = unwrapIpcResult(await api.caseComments.update(commentId, content))

    // Update in cache
    const cached = commentsCache.get(caseId)
    if (cached) {
      const index = cached.findIndex((c) => c.id === commentId)
      if (index !== -1) {
        const updatedList = [...cached]
        updatedList[index] = updated
        commentsCache.set(caseId, updatedList)
      }
    }
  }

  async function deleteComment(caseId: number, commentId: number): Promise<void> {
    if (!api) return
    unwrapIpcResult(await api.caseComments.delete(commentId))

    // Remove from cache
    const cached = commentsCache.get(caseId)
    if (cached) {
      commentsCache.set(
        caseId,
        cached.filter((c) => c.id !== commentId)
      )
    }
  }

  function clearCache(): void {
    commentsCache.clear()
  }

  /** Drop one case's comments (e.g. after the case is deleted). */
  function invalidateCase(caseId: number): void {
    commentsCache.invalidate(caseId)
  }

  return {
    loadComments,
    getComments,
    isLoading,
    createComment,
    updateComment,
    deleteComment,
    clearCache,
    invalidateCase
  }
}
