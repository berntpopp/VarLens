<template>
  <tr>
    <td :colspan="colspan" class="pa-0">
      <v-table density="compact" class="nested-carriers-table bg-grey-lighten-3">
        <thead>
          <tr>
            <th class="text-left">Case</th>
            <th class="text-left">Zygosity</th>
            <th class="text-left">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="error" data-testid="carrier-load-error">
            <td colspan="3" class="text-error">
              Carriers could not be loaded.
              <v-btn
                size="small"
                variant="text"
                class="ml-2"
                data-testid="carrier-load-retry"
                @click="refetch()"
              >
                Retry
              </v-btn>
            </td>
          </tr>
          <tr v-for="carrier in carriers" :key="carrier.case_id">
            <td>{{ carrier.case_name }}</td>
            <td>
              <v-chip size="x-small" :color="zygosityColor(carrier.gt_num)" label>
                {{ formatZygosity(carrier.gt_num) }}
              </v-chip>
            </td>
            <td>
              <v-btn
                size="small"
                variant="text"
                :prepend-icon="mdiOpenInApp"
                @click="emit('navigate-to-case', carrier.case_id)"
              >
                View in Case
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </td>
  </tr>
</template>

<script setup lang="ts">
/**
 * The carriers of one expanded cohort row. The list is a query owned by the
 * row, so it follows the open database, is refetched when the case set
 * changes, and a failed load is shown as such (with a retry), not as "no
 * carriers".
 */
import { computed } from 'vue'
import { useQuery } from '@pinia/colada'
import type { CohortVariant } from '../../../../shared/types/cohort'
import { genotypeZygosity } from '../../../../shared/utils/genotype'
import { mdiOpenInApp } from '@mdi/js'
import { carriersQuery } from '../../queries/carriers'

interface Props {
  variant: CohortVariant
  colspan: number
}

interface Emits {
  (e: 'navigate-to-case', caseId: number): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { data, status, refetch } = useQuery(() => carriersQuery(props.variant))
const error = computed(() => status.value === 'error')
const carriers = computed(() => (error.value ? [] : (data.value ?? [])))

const ZYGOSITY_COLORS = { hom: 'error', het: 'warning', hemi: 'info' } as const

const zygosityColor = (gt: string): string | undefined => {
  const zygosity = genotypeZygosity(gt)
  return zygosity === null ? undefined : ZYGOSITY_COLORS[zygosity]
}

/**
 * The shared zygosity class. A partly missing genotype (one allele of a split
 * multi-allelic site, or a half-call) keeps its stored call next to the
 * class; a genotype without a class is shown as stored.
 */
const formatZygosity = (gt: string): string => {
  const zygosity = genotypeZygosity(gt)
  if (zygosity === null) return gt || '?'
  return gt.includes('.') ? `${zygosity} (${gt})` : zygosity
}
</script>

<style scoped>
.nested-carriers-table {
  border-top: 1px solid rgba(0, 0, 0, 0.12);
}
</style>
