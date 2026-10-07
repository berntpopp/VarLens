/**
 * The tags assigned to one variant, and assigning or removing them.
 *
 * Reads come from the query cache (`queries/tags.ts`) and follow the variant
 * passed in. Writes are optimistic: the chip appears or disappears at once and
 * is put back if the write fails.
 */

import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@pinia/colada'
import type { Tag } from '../../../shared/types/database-entities'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { queryApi } from '../queries/gate'
import { variantTagsQuery, writeVariantTags } from '../queries/tags'

const byName = (a: Tag, b: Tag): number => a.name.localeCompare(b.name)

export function useVariantTags(
  caseId: MaybeRefOrGetter<number>,
  variantId: MaybeRefOrGetter<number>
) {
  const target = computed(() => ({ caseId: toValue(caseId), variantId: toValue(variantId) }))
  const { data, isLoading } = useQuery(() => variantTagsQuery(target.value))
  const variantTags = computed<Tag[]>(() => data.value ?? [])

  /** Assign `tag`; rejects, with the chip removed again, if the write fails. */
  function assignTag(tag: Tag): Promise<void> {
    const { caseId, variantId } = target.value
    return writeVariantTags(
      target.value,
      [...variantTags.value.filter((t) => t.id !== tag.id), tag].sort(byName),
      async () => unwrapIpcResult(await queryApi().tags.assignVariantTag(caseId, variantId, tag.id))
    )
  }

  /** Remove the tag; rejects, with the chip back, if the write fails. */
  function removeTag(tagId: number): Promise<void> {
    const { caseId, variantId } = target.value
    return writeVariantTags(
      target.value,
      variantTags.value.filter((t) => t.id !== tagId),
      async () => unwrapIpcResult(await queryApi().tags.removeVariantTag(caseId, variantId, tagId))
    )
  }

  return { variantTags, isLoading, assignTag, removeTag }
}
