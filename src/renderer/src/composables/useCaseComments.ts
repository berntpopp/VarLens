/**
 * Composable for case comment state management
 *
 * Provides reactive comment state per case with IPC-backed persistence.
 * Used by CaseCommentsTab for comment CRUD.
 */

import { ref } from 'vue'
import type { CaseComment, CommentCategory } from '../../../shared/types/api'
import { useApiService } from './useApiService'

// Cache comments by caseId
const commentsCache = ref<Map<number, CaseComment[]>>(new Map())
const loadingStates = ref<Map<number, boolean>>(new Map())

export const COMMENT_CATEGORIES: CommentCategory[] = [
  'Clinical Note',
  'Lab Result',
  'Interpretation',
  'Follow-up',
  'Family History',
  'Treatment'
]

export const COMMENT_CATEGORY_ICONS: Record<CommentCategory, string> = {
  'Clinical Note': 'mdi-stethoscope',
  'Lab Result': 'mdi-flask',
  Interpretation: 'mdi-lightbulb-outline',
  'Follow-up': 'mdi-calendar-check',
  'Family History': 'mdi-family-tree',
  Treatment: 'mdi-pill'
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
    if (loadingStates.value.get(caseId) === true) return

    loadingStates.value.set(caseId, true)
    try {
      const comments = await api.caseComments.list(caseId)
      commentsCache.value.set(caseId, comments)
    } catch (error) {
      console.error('Failed to load comments:', error)
    } finally {
      loadingStates.value.set(caseId, false)
    }
  }

  function getComments(caseId: number): CaseComment[] {
    return commentsCache.value.get(caseId) ?? []
  }

  function isLoading(caseId: number): boolean {
    return loadingStates.value.get(caseId) ?? false
  }

  async function createComment(
    caseId: number,
    category: CommentCategory,
    content: string
  ): Promise<CaseComment | null> {
    if (!api) return null
    const comment = await api.caseComments.create(caseId, category, content)

    // Add to cache (newest first)
    const cached = commentsCache.value.get(caseId) ?? []
    cached.unshift(comment)
    commentsCache.value.set(caseId, cached)

    return comment
  }

  async function updateComment(caseId: number, commentId: number, content: string): Promise<void> {
    if (!api) return
    const updated = await api.caseComments.update(commentId, content)

    // Update in cache
    const cached = commentsCache.value.get(caseId)
    if (cached) {
      const index = cached.findIndex((c) => c.id === commentId)
      if (index !== -1) {
        const updatedList = [...cached]
        updatedList[index] = updated
        commentsCache.value.set(caseId, updatedList)
      }
    }
  }

  async function deleteComment(caseId: number, commentId: number): Promise<void> {
    if (!api) return
    await api.caseComments.delete(commentId)

    // Remove from cache
    const cached = commentsCache.value.get(caseId)
    if (cached) {
      commentsCache.value.set(
        caseId,
        cached.filter((c) => c.id !== commentId)
      )
    }
  }

  function clearCache(): void {
    commentsCache.value.clear()
    loadingStates.value.clear()
  }

  return {
    loadComments,
    getComments,
    isLoading,
    createComment,
    updateComment,
    deleteComment,
    clearCache
  }
}
