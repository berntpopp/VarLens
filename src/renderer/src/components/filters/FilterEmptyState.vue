<template>
  <!-- Table empty state shared by the case and cohort views (#568). -->
  <div class="text-center pa-8" role="status">
    <v-icon size="48" color="grey-lighten-1" class="mb-4" :icon="mdiFilterOffOutline" />
    <div class="text-h6 text-medium-emphasis mb-2">
      {{ filters.length > 0 ? COPY.title : COPY.noFiltersTitle }}
    </div>
    <template v-if="filters.length > 0">
      <div class="text-body-2 text-medium-emphasis mb-3">{{ COPY.hint }}</div>
      <div class="d-flex flex-wrap justify-center ga-1 mb-4">
        <v-chip v-for="filter in filters" :key="filter.id" size="small" variant="outlined" label>
          <strong>{{ filter.label }}</strong>
          <span class="ml-1">{{ filter.value }}</span>
          <template #append>
            <v-btn
              data-testid="filter-empty-state-remove"
              :aria-label="`${COPY.removeLabel}: ${filter.label} ${filter.value}`"
              :icon="mdiClose"
              size="x-small"
              variant="text"
              density="compact"
              class="ml-1"
              @click="emit('remove', filter.id)"
            />
          </template>
        </v-chip>
      </div>
      <v-btn
        data-testid="filter-empty-state-clear-all"
        variant="tonal"
        color="primary"
        size="small"
        @click="emit('clear-all')"
      >
        <v-icon start size="small" :icon="mdiFilterOff" />
        {{ COPY.clearAll }}
      </v-btn>
    </template>
  </div>
</template>

<script setup lang="ts">
import { mdiClose, mdiFilterOff, mdiFilterOffOutline } from '@mdi/js'
import type { ActiveFilter } from '../../../../shared/types/filters'
import { FILTER_EMPTY_STATE_COPY as COPY } from '../../config/uiCopyConfig'

defineProps<{ filters: ActiveFilter[] }>()

const emit = defineEmits<{
  remove: [id: string]
  'clear-all': []
}>()
</script>
