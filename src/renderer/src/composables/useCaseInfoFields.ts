/**
 * This case's `info.<KEY>` fields and their original sources, from the import
 * field dictionary (#596, #538). One source for the filter autocomplete and
 * the variant details INFO section; see `shared/utils/case-info-fields.ts`.
 */
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@pinia/colada'

import type { CaseInfoField } from '../../../shared/utils/case-info-fields'
import { caseInfoFieldsQuery } from '../queries/case-info-fields'

export function useCaseInfoFields(caseId: MaybeRefOrGetter<number | null | undefined>) {
  const { data } = useQuery(() => caseInfoFieldsQuery(toValue(caseId) ?? 0))
  const fields = computed<CaseInfoField[]>(() => data.value ?? [])
  const sources = computed(() => new Map(fields.value.map((f) => [f.key, f.source])))
  return {
    fields,
    /** Original source of a stored key, or undefined when the dictionary does not list it. */
    sourceOf: (key: string): string | undefined => sources.value.get(key)
  }
}
