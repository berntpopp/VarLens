/**
 * Coloured tag dots in the row annotations (#125), with one tag menu per
 * table instead of one `<v-menu>` per row (see acmg-quick-menu.ts).
 *
 * Case table: the row's own tags; the menu assigns or removes any tag with
 * one click. Cohort table: the tags any carrier case gave the variant, shown
 * read-only (tags are assigned per case, in the case view).
 */
import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import { useQueryCache } from '@pinia/colada'
import type { Tag } from '../../../../shared/types/database-entities'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import { useTags } from '../../composables/useTags'
import { queryApi } from '../../queries/gate'
import { queryKeys } from '../../queries/keys'
import { writeVariantTags } from '../../queries/tags'
import { useSharedMenu, type SharedMenu } from './shared-menu'

export interface TagMenuRequest {
  /** Tags shown for the row (checked in the menu); read live while open. */
  assigned: () => readonly Tag[]
  /** Assign or remove a tag; absent when the row is read-only. */
  toggle?: (tag: Tag) => void
  /** Read-only rows say where their tags come from. */
  readOnlyHint?: string
}

export interface TagQuickMenuState extends SharedMenu<TagMenuRequest> {
  /** Every tag of the database, in display order (by name). */
  tags: ComputedRef<Tag[]>
  /** The tags to show, in display order, for a row's tag ids. */
  tagsOf: (tagIds: readonly number[] | undefined) => Tag[]
  /**
   * A case row's tags as last written or read this session (the details
   * panel's query entry), which win over the page's ids; undefined if none.
   */
  knownTags: (caseId: number, variantId: number) => readonly Tag[] | undefined
}

const TAG_QUICK_MENU_KEY: InjectionKey<TagQuickMenuState> = Symbol('tag-quick-menu')

/** Called by a table: creates the shared tag menu and exposes it to its row cells. */
export function provideTagQuickMenu(): TagQuickMenuState {
  const { getTags } = useTags()
  const tags = computed(() => getTags())
  const tagsOf = (tagIds: readonly number[] | undefined): Tag[] =>
    tagIds === undefined || tagIds.length === 0
      ? []
      : tags.value.filter((tag) => tagIds.includes(tag.id))
  const cache = useQueryCache()
  const knownTags = (caseId: number, variantId: number): readonly Tag[] | undefined =>
    cache.getQueryData<Tag[]>(queryKeys.variantTags(caseId, variantId))
  const state: TagQuickMenuState = { ...useSharedMenu<TagMenuRequest>(), tags, tagsOf, knownTags }
  provide(TAG_QUICK_MENU_KEY, state)
  return state
}

/** Called by a row cell: the table's shared tag menu, or null outside a table. */
export function injectTagQuickMenu(): TagQuickMenuState | null {
  return inject(TAG_QUICK_MENU_KEY, null)
}

/**
 * Assign the tag to a case row, or remove it when assigned. Optimistic: the
 * dot changes at once and is put back if the write fails (which rejects).
 */
export function toggleCaseRowTag(
  target: { caseId: number; variantId: number },
  assigned: readonly Tag[],
  tag: Tag
): Promise<void> {
  const { caseId, variantId } = target
  // The row's page tags become the entry the write starts from (and restores on failure).
  const cache = useQueryCache()
  const key = queryKeys.variantTags(caseId, variantId)
  if (cache.getQueryData(key) === undefined) cache.setQueryData(key, [...assigned])
  const isAssigned = assigned.some((t) => t.id === tag.id)
  const next = isAssigned ? assigned.filter((t) => t.id !== tag.id) : [...assigned, tag]
  return writeVariantTags(
    target,
    [...next].sort((a, b) => a.name.localeCompare(b.name)),
    async () =>
      unwrapIpcResult(
        isAssigned
          ? await queryApi().tags.removeVariantTag(caseId, variantId, tag.id)
          : await queryApi().tags.assignVariantTag(caseId, variantId, tag.id)
      )
  )
}

/** Accessible name (and tooltip) of a row's tag button. */
export function tagButtonLabel(tags: readonly Tag[], readOnly: boolean): string {
  const names = tags.map((t) => t.name).join(', ')
  if (readOnly) return tags.length === 0 ? 'No tags' : `Tags: ${names}`
  return tags.length === 0 ? 'Add tag' : `Tags: ${names} — change tags`
}
