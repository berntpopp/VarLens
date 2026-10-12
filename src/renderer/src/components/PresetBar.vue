<template>
  <!-- No expand transition: animating the row height shifted the table below
       it on every frame of the animation (layout shift). -->
  <div
    v-if="visiblePresets.length > 0 || hasActiveFilters"
    class="preset-bar px-3 py-1 d-flex align-center ga-1"
  >
    <!-- Preset toggle chips: one line that scrolls sideways (arrows only on
         overflow), so a narrower toolbar never adds a row above the table. -->
    <v-slide-group v-if="visiblePresets.length > 0" show-arrows class="preset-bar__chips">
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
    </v-slide-group>

    <v-divider v-if="hasActiveFilters && visiblePresets.length > 0" vertical class="mx-1" />

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
  flex-wrap: nowrap;
}

.preset-bar > * {
  flex-shrink: 0;
}

/* The chip strip is the one part that gives up width (and scrolls). */
.preset-bar > .preset-bar__chips {
  flex-shrink: 1;
  min-width: 0;
}

.preset-bar__chips :deep(.v-slide-group__content) {
  gap: 4px;
  align-items: center;
}

.preset-bar :deep(.v-chip) {
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}
</style>
