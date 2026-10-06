<template>
  <!-- No expand transition: animating the row height shifted the table below
       it on every frame of the animation (layout shift). -->
  <div v-if="visiblePresets.length > 0" class="preset-bar px-3 py-1 d-flex align-center ga-1">
    <!-- Preset toggle chips -->
    <v-chip
      v-for="preset in visiblePresets"
      :key="preset.id"
      :color="isPresetActive(preset.id) ? 'primary' : undefined"
      :variant="isPresetActive(preset.id) ? 'flat' : 'outlined'"
      size="small"
      label
      role="button"
      :aria-pressed="isPresetActive(preset.id)"
      :aria-label="`Filter preset: ${preset.name}`"
      @click="emit('toggle', preset.id)"
    >
      <v-icon v-if="!preset.isBuiltIn" start size="x-small" :icon="mdiAccount" />
      {{ preset.name }}
      <v-tooltip activator="parent" location="bottom">
        {{ preset.description || 'No description' }}
      </v-tooltip>
    </v-chip>

    <v-divider v-if="hasActiveFilters" vertical class="mx-1" />

    <!-- Save current filters as preset -->
    <v-btn
      v-if="hasActiveFilters"
      size="x-small"
      variant="text"
      color="primary"
      @click="emit('save')"
    >
      <v-icon start size="x-small" :icon="mdiContentSaveOutline" />
      Save
    </v-btn>

    <!-- Manage presets -->
    <IconButton
      label="Manage presets"
      :icon="mdiCogOutline"
      size="x-small"
      @click="emit('manage')"
    />
  </div>
</template>

<script setup lang="ts">
import type { FilterPreset } from '../../../shared/types/filter-presets'
import { mdiAccount, mdiCogOutline, mdiContentSaveOutline } from '@mdi/js'
import IconButton from './common/IconButton.vue'

defineProps<{
  visiblePresets: FilterPreset[]
  isPresetActive: (id: number) => boolean
  hasActiveFilters: boolean
}>()

const emit = defineEmits<{
  toggle: [id: number]
  save: []
  manage: []
}>()
</script>

<style scoped>
.preset-bar {
  background: color-mix(in srgb, rgb(var(--v-theme-surface)) 95%, rgb(var(--v-theme-primary)));
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
  flex-wrap: wrap;
}

/* Narrow widths wrap the chips into many rows: 18px chips + 8px row gap keep
   them >24px apart (WCAG 2.5.8 spacing) without costing desktop table rows. */
@media (max-width: 839.98px) {
  .preset-bar {
    row-gap: 0.5rem;
  }
}

.preset-bar :deep(.v-chip) {
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}
</style>
