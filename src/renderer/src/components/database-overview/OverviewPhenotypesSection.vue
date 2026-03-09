<template>
  <div class="mb-4">
    <div
      class="text-title-small mb-2 d-flex align-center cursor-pointer"
      @click="expanded = !expanded"
    >
      <v-icon size="small" class="mr-1">
        {{ expanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
      </v-icon>
      <v-icon size="small" class="mr-1">mdi-human</v-icon>
      Top Phenotypes ({{ phenotypes.length }})
    </div>

    <v-expand-transition>
      <div v-show="expanded">
        <v-data-table
          v-if="phenotypes.length > 0"
          :headers="phenotypeHeaders"
          :items="phenotypes"
          density="compact"
          :items-per-page="10"
        >
          <template #[`item.case_count`]="{ item }">
            <span class="text-right d-block">
              {{ item.case_count.toLocaleString() }}
            </span>
          </template>
        </v-data-table>
        <div v-else class="text-medium-emphasis text-body-medium py-4">
          No phenotypes assigned to any case.
        </div>
      </div>
    </v-expand-transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { OverviewPhenotype } from '../../../../shared/types/database-overview'

defineProps<{
  phenotypes: OverviewPhenotype[]
}>()

const expanded = ref(true)

const phenotypeHeaders = [
  { title: 'HPO ID', key: 'hpo_id', sortable: true },
  { title: 'Label', key: 'hpo_label', sortable: true },
  { title: 'Case Count', key: 'case_count', sortable: true, align: 'end' as const }
]
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
