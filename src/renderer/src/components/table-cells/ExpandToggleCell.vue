<template>
  <!-- Header cell: names the expand column for assistive tech (empty-table-header). -->
  <span v-if="header" class="visually-hidden">{{ capitalizedSubject }}</span>
  <IconButton
    v-else-if="internalItem && isExpanded && toggleExpand"
    :label="expanded ? `Hide ${subject}` : `Show ${subject}`"
    :icon="expanded ? mdiChevronUp : mdiChevronDown"
    :aria-expanded="expanded"
    :tooltip="false"
    size="x-small"
    @click.stop="toggleExpand(internalItem)"
  />
</template>

<script setup lang="ts" generic="T">
/**
 * Named expand toggle for v-data-table's `data-table-expand` column.
 *
 * Vuetify's built-in expand button has no accessible name (axe: button-name).
 * Bind the `item.data-table-expand` slot props straight through
 * (`<ExpandToggleCell v-bind="slot" />`), or pass `header` for the column header.
 */
import { computed } from 'vue'
import { mdiChevronDown, mdiChevronUp } from '@mdi/js'
import IconButton from '../common/IconButton.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    subject?: string
    header?: boolean
    internalItem?: T
    isExpanded?: (item: T) => boolean
    toggleExpand?: (item: T) => void
  }>(),
  {
    subject: 'carriers',
    header: false,
    internalItem: undefined,
    isExpanded: undefined,
    toggleExpand: undefined
  }
)

const expanded = computed(() =>
  props.internalItem !== undefined && props.isExpanded
    ? props.isExpanded(props.internalItem)
    : false
)
const capitalizedSubject = computed(
  () => props.subject.charAt(0).toUpperCase() + props.subject.slice(1)
)
</script>
