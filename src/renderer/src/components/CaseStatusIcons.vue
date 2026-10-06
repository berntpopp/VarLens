<template>
  <!--
    Compact status glyphs (sidebar case list, toolbar header). Unknown values
    render no glyph — a "?" per row is noise — but stay in the accessible text.
  -->
  <span class="d-inline-flex align-center case-status-icons">
    <v-icon
      v-if="status !== 'unknown'"
      :icon="statusIcon"
      :color="onToolbar ? resolvedStatusColor : statusColor"
      :size="statusSize"
      :aria-hidden="true"
      :data-tooltip="statusText"
      :data-tooltip-location="tooltipLocation"
    />
    <v-icon
      v-if="sex !== 'unknown'"
      :icon="sexIcon"
      :color="onToolbar ? resolvedSexColor : sexColor"
      :size="sexSize"
      :aria-hidden="true"
      :data-tooltip="sexText"
      :data-tooltip-location="tooltipLocation"
      class="ml-1"
    />
    <span class="visually-hidden">{{ statusText }}, {{ sexText }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from 'vuetify'
import { STATUS_ICONS, STATUS_COLORS, SEX_ICONS, SEX_COLORS } from '../composables/useCaseMetadata'
import type { AffectedStatus, CaseSex } from '../../../shared/types/api'

const TOOLBAR_COLOR_MAP: Partial<Record<string, string>> = {
  'grey-darken-1': 'white',
  blue: 'light-blue-lighten-3',
  pink: 'pink-lighten-3',
  purple: 'purple-lighten-3',
  error: 'red-lighten-3',
  success: 'green-lighten-3'
}

const props = withDefaults(
  defineProps<{
    status: AffectedStatus
    sex: CaseSex
    statusSize?: string
    sexSize?: string
    tooltipLocation?: 'top' | 'bottom' | 'start' | 'end'
    onToolbar?: boolean
  }>(),
  {
    statusSize: 'small',
    sexSize: 'x-small',
    tooltipLocation: 'top',
    onToolbar: false
  }
)

const statusIcon = computed(() => STATUS_ICONS[props.status])
const statusColor = computed(() => STATUS_COLORS[props.status])
const sexIcon = computed(() => SEX_ICONS[props.sex])
const sexColor = computed(() => SEX_COLORS[props.sex])

// The dark theme's app bar is light (primary #7BAED4): pastel accents vanish on
// it, so toolbar glyphs fall back to the on-primary token there.
const theme = useTheme()
function toolbarColor(color: string): string {
  if (theme.current.value.dark) return 'on-primary'
  return TOOLBAR_COLOR_MAP[color] ?? color
}
const resolvedStatusColor = computed(() => toolbarColor(statusColor.value))
const resolvedSexColor = computed(() => toolbarColor(sexColor.value))

const statusText = computed(() =>
  props.status === 'unknown' ? 'Affected status unknown' : capitalize(props.status)
)
const sexText = computed(() => (props.sex === 'unknown' ? 'Sex unknown' : `Sex: ${props.sex}`))

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
</script>
