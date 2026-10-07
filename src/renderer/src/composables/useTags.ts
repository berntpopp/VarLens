/**
 * The tags of the open database: the list and its create/update/delete.
 *
 * The list is server data and lives in the query cache (`queries/tags.ts`).
 * Tags assigned to a variant are in `useVariantTags`.
 */

import { computed } from 'vue'
import { useQuery } from '@pinia/colada'
import type { Tag } from '../../../shared/types/database-entities'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { loadIfAllowed, queryApi } from '../queries/gate'
import { invalidateTags, tagListQuery } from '../queries/tags'

export function useTags() {
  const { data, refresh } = useQuery(tagListQuery)
  const tags = computed<Tag[]>(() => data.value ?? [])

  /** Resolves once the tag list has loaded (or failed; failures are logged). */
  function loadTags(): Promise<void> {
    return loadIfAllowed('workflow.tags', refresh)
  }

  function getTags(): Tag[] {
    return tags.value
  }

  async function createTag(name: string, color: string): Promise<Tag> {
    const tag = unwrapIpcResult(await queryApi().tags.create(name, color))
    await invalidateTags(false)
    return tag
  }

  async function updateTag(id: number, updates: { name?: string; color?: string }): Promise<Tag> {
    const tag = unwrapIpcResult(await queryApi().tags.update(id, updates))
    await invalidateTags(true)
    return tag
  }

  async function deleteTag(id: number): Promise<void> {
    unwrapIpcResult(await queryApi().tags.delete(id))
    await invalidateTags(true)
  }

  /** Number of variants the tag is assigned to. */
  async function getTagUsageCount(tagId: number): Promise<number> {
    return unwrapIpcResult(await queryApi().tags.getUsageCount(tagId))
  }

  return { loadTags, getTags, createTag, updateTag, deleteTag, getTagUsageCount }
}

// Predefined tag colors for the color picker
export const TAG_COLORS = [
  '#F44336', // Red
  '#E91E63', // Pink
  '#9C27B0', // Purple
  '#673AB7', // Deep Purple
  '#3F51B5', // Indigo
  '#2196F3', // Blue
  '#03A9F4', // Light Blue
  '#00BCD4', // Cyan
  '#009688', // Teal
  '#4CAF50', // Green
  '#8BC34A', // Light Green
  '#CDDC39', // Lime
  '#FFEB3B', // Yellow
  '#FFC107', // Amber
  '#FF9800', // Orange
  '#FF5722', // Deep Orange
  '#795548', // Brown
  '#9E9E9E', // Grey
  '#607D8B' // Blue Grey
]
