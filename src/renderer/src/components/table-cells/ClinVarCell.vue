<template>
  <!-- Tooltips via the app-wide DelegatedTooltip (data-tooltip), not per-cell v-tooltip -->
  <span
    v-if="hasValue && hasLink"
    class="external-link"
    :data-tooltip="significance"
    data-tooltip-location="top"
    @click="handleClick"
  >
    <v-chip :color="chipColor" size="small" label>
      {{ displayValue }}
    </v-chip>
    <v-icon size="x-small" class="external-link__icon" :icon="mdiOpenInNew" />
  </span>
  <v-chip
    v-else-if="hasValue"
    :color="chipColor"
    size="small"
    label
    :data-tooltip="significance"
    data-tooltip-location="top"
  >
    {{ displayValue }}
  </v-chip>
  <span v-else class="text-muted">--</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getClinVarColor } from '../../composables/useTableColors'
import { mdiOpenInNew } from '@mdi/js'

interface ClinVarCellProps {
  significance: string | null
  url?: string | null
}

const props = defineProps<ClinVarCellProps>()
const emit = defineEmits<{
  (e: 'click', url: string, event: MouseEvent): void
}>()

const hasValue = computed(
  () => props.significance !== null && props.significance !== undefined && props.significance !== ''
)
const hasLink = computed(() => props.url !== null && props.url !== undefined && props.url !== '')
const chipColor = computed(() => getClinVarColor(props.significance))
const displayValue = computed(() => props.significance?.replace(/_/g, ' ') ?? '--')

const handleClick = (event: MouseEvent) => {
  if (props.url !== null && props.url !== undefined && props.url !== '') {
    emit('click', props.url, event)
  }
}
</script>
