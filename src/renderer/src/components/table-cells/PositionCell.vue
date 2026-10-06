<template>
  <a
    v-if="hasLink"
    class="external-link genomic-coordinate"
    :href="url ?? undefined"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="`Position ${formattedPosition} in genome browser (opens in a new tab)`"
    @click.prevent="handleClick"
  >
    {{ formattedPosition }}
    <v-icon size="x-small" class="external-link__icon" :icon="mdiOpenInNew" />
  </a>
  <span v-else class="genomic-coordinate">{{ formattedPosition }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatPosition } from '../../composables/useTableFormatters'
import { mdiOpenInNew } from '@mdi/js'

interface PositionCellProps {
  position: number
  url?: string | null
}

const props = defineProps<PositionCellProps>()
const emit = defineEmits<{
  (e: 'click', url: string, event: MouseEvent): void
}>()

const formattedPosition = computed(() => formatPosition(props.position))
const hasLink = computed(() => props.url !== null && props.url !== undefined && props.url !== '')

const handleClick = (event: MouseEvent) => {
  if (props.url !== null && props.url !== undefined && props.url !== '') {
    emit('click', props.url, event)
  }
}
</script>
