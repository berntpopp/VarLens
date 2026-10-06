/**
 * Row render keys scoped to the current result set.
 *
 * Keying `<tr>`s by row id alone makes Vue *move* the existing row elements
 * when a sort reorders the page. Every moved row is a layout-shift source, so
 * a sort registered 0.01-0.07 of shifts (cohort columns "jumping") even though
 * nothing about the layout changed. Prefixing the id with a generation that
 * bumps whenever the ordered id list changes gives a new result set fresh row
 * elements (inserted elements are not layout shifts), while annotation or
 * link updates on the same rows keep their keys and patch in place.
 *
 * Identity for selection, keyboard navigation and data stays the plain id;
 * only Vuetify's `item-value` (and anything keyed by it, such as the cohort
 * `expanded` model) sees the render key.
 */
import { computed, ref, watch, type Ref, type WritableComputedRef } from 'vue'

const SEPARATOR = '#'

export interface ResultSetKeys<T> {
  generation: Ref<number>
  /** Stable function for `item-value`: `<generation>#<id>`. */
  rowKey: (row: T) => string
  /** Strip the generation prefix again. */
  idOfKey: (key: string) => string
  /** Two-way view of an id list (e.g. expanded rows) as render keys. */
  keyedModel: (ids: Ref<string[]>) => WritableComputedRef<string[]>
}

export function useResultSetKeys<T>(
  rows: () => readonly T[],
  id: keyof T | ((row: T) => string | number)
): ResultSetKeys<T> {
  const idOf = (row: T): string | number =>
    typeof id === 'function' ? id(row) : (row[id] as unknown as string | number)
  const generation = ref(0)
  watch(
    () => rows().map(idOf).join('\u0000'),
    () => {
      generation.value += 1
    }
  )

  const toKey = (id: string | number): string => `${generation.value}${SEPARATOR}${id}`
  const idOfKey = (key: string): string => key.slice(key.indexOf(SEPARATOR) + 1)

  return {
    generation,
    rowKey: (row) => toKey(idOf(row)),
    idOfKey,
    keyedModel: (ids) =>
      computed({
        get: () => ids.value.map(toKey),
        set: (keys) => {
          ids.value = keys.map(idOfKey)
        }
      })
  }
}
