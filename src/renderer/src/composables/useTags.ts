/**
 * Composable for tag state management
 *
 * Provides reactive tag state with IPC-backed persistence.
 * Used for tag CRUD operations and variant-tag assignments.
 */

import { ref } from 'vue'
import type { Tag } from '../../../main/database/types'

// Cache all tags (global list)
const tagsCache = ref<Tag[]>([])

// Loading state for tag list
const isLoadingTags = ref(false)

// Cache variant tags by key (caseId:variantId)
const variantTagsCache = ref<Map<string, Tag[]>>(new Map())

// Loading states per variant key
const variantTagsLoading = ref<Map<string, boolean>>(new Map())

export function useTags() {
  // Build variant key for cache lookup
  function variantTagKey(caseId: number, variantId: number): string {
    return `${caseId}:${variantId}`
  }

  // ============================================================
  // Tag List Operations
  // ============================================================

  /**
   * Load all tags from database
   */
  async function loadTags(): Promise<void> {
    if (isLoadingTags.value) return

    isLoadingTags.value = true
    try {
      const tags = await window.api.tags.list()
      tagsCache.value = tags
    } catch (error) {
      console.error('Failed to load tags:', error)
    } finally {
      isLoadingTags.value = false
    }
  }

  /**
   * Get cached tags list
   */
  function getTags(): Tag[] {
    return tagsCache.value
  }

  /**
   * Create a new tag
   *
   * @param name - Tag name
   * @param color - Tag color (hex color)
   * @returns Created tag
   */
  async function createTag(name: string, color: string): Promise<Tag> {
    const tag = await window.api.tags.create(name, color)
    // Update cache
    tagsCache.value = [...tagsCache.value, tag].sort((a, b) => a.name.localeCompare(b.name))
    return tag
  }

  /**
   * Update a tag
   *
   * @param id - Tag ID
   * @param updates - Partial tag updates
   * @returns Updated tag
   */
  async function updateTag(id: number, updates: { name?: string; color?: string }): Promise<Tag> {
    const tag = await window.api.tags.update(id, updates)
    // Update cache
    tagsCache.value = tagsCache.value
      .map((t) => (t.id === id ? tag : t))
      .sort((a, b) => a.name.localeCompare(b.name))
    // Also update variant tags cache if this tag was assigned
    variantTagsCache.value.forEach((tags, key) => {
      const updated = tags.map((t) => (t.id === id ? tag : t))
      variantTagsCache.value.set(key, updated)
    })
    return tag
  }

  /**
   * Delete a tag
   *
   * @param id - Tag ID
   */
  async function deleteTag(id: number): Promise<void> {
    await window.api.tags.delete(id)
    // Update cache
    tagsCache.value = tagsCache.value.filter((t) => t.id !== id)
    // Also remove from variant tags cache
    variantTagsCache.value.forEach((tags, key) => {
      const filtered = tags.filter((t) => t.id !== id)
      variantTagsCache.value.set(key, filtered)
    })
  }

  /**
   * Get tag usage count
   *
   * @param tagId - Tag ID
   * @returns Number of variant-tag assignments
   */
  async function getTagUsageCount(tagId: number): Promise<number> {
    return await window.api.tags.getUsageCount(tagId)
  }

  // ============================================================
  // Variant Tag Operations
  // ============================================================

  /**
   * Load tags for a specific variant
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   */
  async function loadVariantTags(caseId: number, variantId: number): Promise<void> {
    const key = variantTagKey(caseId, variantId)

    // Skip if already loading
    if (variantTagsLoading.value.get(key) === true) return

    variantTagsLoading.value.set(key, true)
    try {
      const tags = await window.api.tags.getVariantTags(caseId, variantId)
      variantTagsCache.value.set(key, tags)
    } catch (error) {
      console.error('Failed to load variant tags:', error)
    } finally {
      variantTagsLoading.value.set(key, false)
    }
  }

  /**
   * Get cached tags for a variant
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   * @returns Array of tags or empty array if not cached
   */
  function getVariantTags(caseId: number, variantId: number): Tag[] {
    return variantTagsCache.value.get(variantTagKey(caseId, variantId)) ?? []
  }

  /**
   * Check if variant tags are loading
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   */
  function isVariantTagsLoading(caseId: number, variantId: number): boolean {
    return variantTagsLoading.value.get(variantTagKey(caseId, variantId)) ?? false
  }

  /**
   * Check if variant has a specific tag
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   * @param tagId - Tag ID
   */
  function hasTag(caseId: number, variantId: number, tagId: number): boolean {
    const tags = getVariantTags(caseId, variantId)
    return tags.some((t) => t.id === tagId)
  }

  /**
   * Assign a tag to a variant (with optimistic update)
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   * @param tagId - Tag ID
   */
  async function assignVariantTag(caseId: number, variantId: number, tagId: number): Promise<void> {
    const key = variantTagKey(caseId, variantId)
    const currentTags = variantTagsCache.value.get(key) ?? []
    const tagToAdd = tagsCache.value.find((t) => t.id === tagId)

    // Optimistic update
    if (tagToAdd && !currentTags.some((t) => t.id === tagId)) {
      variantTagsCache.value.set(
        key,
        [...currentTags, tagToAdd].sort((a, b) => a.name.localeCompare(b.name))
      )
    }

    try {
      await window.api.tags.assignVariantTag(caseId, variantId, tagId)
    } catch (error) {
      console.error('Failed to assign variant tag:', error)
      // Revert optimistic update
      variantTagsCache.value.set(key, currentTags)
      throw error
    }
  }

  /**
   * Remove a tag from a variant (with optimistic update)
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   * @param tagId - Tag ID
   */
  async function removeVariantTag(caseId: number, variantId: number, tagId: number): Promise<void> {
    const key = variantTagKey(caseId, variantId)
    const currentTags = variantTagsCache.value.get(key) ?? []

    // Optimistic update
    variantTagsCache.value.set(
      key,
      currentTags.filter((t) => t.id !== tagId)
    )

    try {
      await window.api.tags.removeVariantTag(caseId, variantId, tagId)
    } catch (error) {
      console.error('Failed to remove variant tag:', error)
      // Revert optimistic update
      variantTagsCache.value.set(key, currentTags)
      throw error
    }
  }

  /**
   * Toggle a tag on a variant
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   * @param tagId - Tag ID
   */
  async function toggleVariantTag(caseId: number, variantId: number, tagId: number): Promise<void> {
    if (hasTag(caseId, variantId, tagId)) {
      await removeVariantTag(caseId, variantId, tagId)
    } else {
      await assignVariantTag(caseId, variantId, tagId)
    }
  }

  /**
   * Set all tags for a variant (with optimistic update)
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   * @param tagIds - Array of tag IDs
   */
  async function setVariantTags(
    caseId: number,
    variantId: number,
    tagIds: number[]
  ): Promise<void> {
    const key = variantTagKey(caseId, variantId)
    const currentTags = variantTagsCache.value.get(key) ?? []

    // Optimistic update
    const newTags = tagsCache.value
      .filter((t) => tagIds.includes(t.id))
      .sort((a, b) => a.name.localeCompare(b.name))
    variantTagsCache.value.set(key, newTags)

    try {
      await window.api.tags.setVariantTags(caseId, variantId, tagIds)
    } catch (error) {
      console.error('Failed to set variant tags:', error)
      // Revert optimistic update
      variantTagsCache.value.set(key, currentTags)
      throw error
    }
  }

  /**
   * Bulk load variant tags for multiple variants
   *
   * @param caseId - Case ID
   * @param variantIds - Array of variant IDs
   */
  async function loadVariantTagsBatch(caseId: number, variantIds: number[]): Promise<void> {
    // Filter out already cached variants
    const uncachedIds = variantIds.filter(
      (id) => !variantTagsCache.value.has(variantTagKey(caseId, id))
    )

    // Load in parallel
    await Promise.all(uncachedIds.map((id) => loadVariantTags(caseId, id)))
  }

  // ============================================================
  // Cache Management
  // ============================================================

  /**
   * Clear all caches (call on case switch)
   */
  function clearCache(): void {
    variantTagsCache.value.clear()
    variantTagsLoading.value.clear()
  }

  /**
   * Clear tags list cache (call to force reload)
   */
  function clearTagsCache(): void {
    tagsCache.value = []
  }

  return {
    // Tag list operations
    loadTags,
    getTags,
    createTag,
    updateTag,
    deleteTag,
    getTagUsageCount,
    isLoadingTags,

    // Variant tag operations
    loadVariantTags,
    getVariantTags,
    isVariantTagsLoading,
    hasTag,
    assignVariantTag,
    removeVariantTag,
    toggleVariantTag,
    setVariantTags,
    loadVariantTagsBatch,

    // Cache management
    clearCache,
    clearTagsCache
  }
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
