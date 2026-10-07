/**
 * The comments of one case, and creating, editing and deleting them.
 *
 * Reads come from the query cache (`queries/case-comments.ts`) and follow the
 * case passed in; a case id of 0 reads nothing. A write resolves once the
 * list has been refetched.
 */

import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@pinia/colada'
import type { CaseComment, CommentCategory } from '../../../shared/types/api'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { caseCommentsQuery } from '../queries/case-comments'
import { queryApi } from '../queries/gate'
import { refetchAfterWrite } from '../queries/invalidation'
import { queryKeys } from '../queries/keys'
import {
  mdiCalendarCheck,
  mdiFamilyTree,
  mdiFlask,
  mdiLightbulbOutline,
  mdiPill,
  mdiStethoscope
} from '@mdi/js'

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

export function useCaseComments(caseId: MaybeRefOrGetter<number>) {
  const { data, isPending } = useQuery(() => caseCommentsQuery(toValue(caseId)))
  const comments = computed<CaseComment[]>(() => data.value ?? [])

  /** Run a write for the current case, then refetch that case's comments. */
  async function write<T>(run: () => Promise<T>): Promise<T> {
    const key = queryKeys.caseComments(toValue(caseId))
    const result = await run()
    await refetchAfterWrite(key)
    return result
  }

  function createComment(category: CommentCategory, content: string): Promise<CaseComment> {
    const id = toValue(caseId)
    return write(async () =>
      unwrapIpcResult(await queryApi().caseComments.create(id, category, content))
    )
  }

  function updateComment(commentId: number, content: string): Promise<CaseComment> {
    return write(async () =>
      unwrapIpcResult(await queryApi().caseComments.update(commentId, content))
    )
  }

  function deleteComment(commentId: number): Promise<void> {
    return write(async () => {
      unwrapIpcResult(await queryApi().caseComments.delete(commentId))
    })
  }

  return { comments, isLoading: isPending, createComment, updateComment, deleteComment }
}
