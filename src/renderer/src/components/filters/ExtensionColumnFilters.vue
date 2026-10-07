<template>
  <div class="extension-column-filters">
    <v-expansion-panels
      v-if="typeSections.length > 0"
      variant="accordion"
      multiple
      class="extension-filter-accordion"
    >
      <v-expansion-panel
        v-for="section in typeSections"
        :key="section.typeKey"
        :title="section.label"
      >
        <v-expansion-panel-text>
          <ExtensionColumnControl
            v-for="col in section.columns"
            :key="col.dottedKey"
            :scope="scope"
            :column="col"
            :model-value="modelValue[col.dottedKey]"
            @update:model-value="updateFilter(col.dottedKey, $event)"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <div v-else class="text-caption text-medium-emphasis py-2">
      No structural variants in the current scope.
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ExtensionColumnFilters — shared filter UI surface mounted in the case
 * view filter drawer, cohort filter bar, and burden analysis panel.
 *
 * Responsibilities:
 * - Iterate `VARIANT_EXTENSION_REGISTRY` to discover type sections and
 *   their columns.
 * - Read which variant types the scope has (`typesPresentQuery`) to hide
 *   sections that have NO data in the current case/cohort (so single-SNV
 *   datasets don't show empty SV/CNV/STR accordions).
 * - Render one `ExtensionColumnControl` per column; each loads its own
 *   metadata when its section is first opened.
 * - Dispatch `update:modelValue` with a NEW `ColumnFiltersParam` map each
 *   time a control changes.
 *
 * The component is a *view layer* — it does not apply filters itself. The
 * parent (FilterToolbar / CohortFilterBar) receives the updated map via
 * `v-model` and pipes it through FilterState + useFilters.buildIpcParams.
 */
import { computed } from 'vue'
import { useQuery } from '@pinia/colada'
import type { ColumnFilter, ColumnFiltersParam } from '../../../../shared/types/column-filters'
import {
  VARIANT_EXTENSION_REGISTRY,
  type FilterKind
} from '../../../../shared/types/variant-extension-registry-data'
import { typesPresentQuery } from '../../queries/column-meta'
import type { QueryScope } from '../../queries/keys'
import ExtensionColumnControl from './ExtensionColumnControl.vue'

const props = defineProps<{
  scope: QueryScope
  modelValue: ColumnFiltersParam
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ColumnFiltersParam]
}>()

// While another scope's types load, the previous sections stay: dropping them
// would close the sections the user has open. Column metadata is never kept.
const { data: typesPresent } = useQuery(() => ({
  ...typesPresentQuery(props.scope),
  placeholderData: (previous: Set<string> | undefined) => previous
}))

interface TypeSection {
  typeKey: string
  label: string
  columns: Array<{
    dottedKey: string
    label: string
    kind: FilterKind
  }>
}

const typeSections = computed<TypeSection[]>(() => {
  const sections: TypeSection[] = []
  for (const [typeKey, def] of Object.entries(VARIANT_EXTENSION_REGISTRY)) {
    if (typesPresent.value?.has(def.variantTypeValue) !== true) continue
    const columns: TypeSection['columns'] = []
    for (const [colName, colDef] of Object.entries(def.columns)) {
      const dottedKey = `${typeKey}.${colName}`
      columns.push({
        dottedKey,
        label: colDef.label ?? colName.replace(/_/g, ' '),
        kind: colDef.kind
      })
    }
    sections.push({
      typeKey,
      label: typeKey.toUpperCase(),
      columns
    })
  }
  return sections
})

function updateFilter(dottedKey: string, filter: ColumnFilter | undefined): void {
  const next: ColumnFiltersParam = { ...props.modelValue }
  if (filter === undefined) {
    delete next[dottedKey]
  } else {
    next[dottedKey] = filter
  }
  emit('update:modelValue', next)
}
</script>
