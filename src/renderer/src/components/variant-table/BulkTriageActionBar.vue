<template>
  <transition name="slide-fade">
    <div
      v-if="selectedCount > 0"
      class="bulk-triage-action-bar elevation-4 rounded-pill pa-2 px-4 d-flex align-center ga-3"
      data-testid="bulk-triage-bar"
      role="region"
      aria-label="Bulk Triage Bar"
    >
      <span class="text-body-2 font-weight-bold text-no-wrap" data-testid="bulk-selected-count">
        {{ selectedCount }} selected
      </span>

      <v-divider vertical class="my-1" />

      <!-- Star / Unstar -->
      <v-btn
        size="small"
        variant="tonal"
        color="primary"
        :prepend-icon="mdiStar"
        :loading="isExecuting"
        data-testid="bulk-action-star"
        @click="emit('apply', { starred: true })"
      >
        Star
      </v-btn>

      <v-btn
        size="small"
        variant="tonal"
        :prepend-icon="mdiStarOutline"
        :loading="isExecuting"
        data-testid="bulk-action-unstar"
        @click="emit('apply', { starred: false })"
      >
        Unstar
      </v-btn>

      <!-- ACMG Menu -->
      <v-menu>
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            size="small"
            variant="tonal"
            :prepend-icon="mdiClipboardCheck"
            :loading="isExecuting"
            data-testid="bulk-action-acmg"
          >
            ACMG
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item
            v-for="acmg in acmgOptions"
            :key="acmg.value"
            :data-testid="`bulk-acmg-option-${acmg.short.toLowerCase()}`"
            @click="emit('apply', { acmg_classification: acmg.value })"
          >
            <template #prepend>
              <CellChip :color="acmg.color" size="x-small" label class="mr-2">
                {{ acmg.short }}
              </CellChip>
            </template>
            <v-list-item-title>{{ acmg.title }}</v-list-item-title>
          </v-list-item>
          <v-divider class="my-1" />
          <v-list-item
            data-testid="bulk-acmg-option-clear"
            @click="emit('apply', { acmg_classification: null })"
          >
            <v-list-item-title class="text-medium-emphasis">Clear classification</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>

      <!-- Apply Tag Menu -->
      <v-menu v-if="tags.length > 0">
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            size="small"
            variant="tonal"
            :prepend-icon="mdiTagOutline"
            :loading="isExecuting"
            data-testid="bulk-action-tag"
          >
            Apply Tag
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item
            v-for="tag in tags"
            :key="tag.id"
            :data-testid="`bulk-tag-option-${tag.id}`"
            @click="emit('apply', { tag_id: tag.id })"
          >
            <template #prepend>
              <span class="tag-color-dot mr-2" :style="{ backgroundColor: tag.color }" />
            </template>
            <v-list-item-title>{{ tag.name }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>

      <v-divider vertical class="my-1" />

      <!-- Clear selection -->
      <v-btn
        size="small"
        variant="text"
        :icon="mdiClose"
        aria-label="Clear selection"
        data-testid="bulk-action-clear"
        @click="emit('clear')"
      />
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getActivePinia } from 'pinia'
import { mdiStar, mdiStarOutline, mdiClipboardCheck, mdiTagOutline, mdiClose } from '@mdi/js'
import { CellChip } from '../table-cells/cell-components'
import { useTags } from '../../composables/useTags'
import type { BatchPerCaseAnnotationUpdates } from '../../../../shared/types/api'
import {
  ACMG_ABBREV,
  ACMG_CLASSIFICATIONS,
  ACMG_COLORS
} from '../../../../shared/config/domain.config'
import type { Tag } from '../../../../shared/types/database-entities'

defineProps<{
  selectedCount: number
  isExecuting?: boolean
}>()

const emit = defineEmits<{
  (e: 'apply', updates: BatchPerCaseAnnotationUpdates): void
  (e: 'clear'): void
}>()

let tagComposable: ReturnType<typeof useTags> | null = null
if (getActivePinia()) {
  try {
    tagComposable = useTags()
    void tagComposable.loadTags()
  } catch {
    tagComposable = null
  }
}
const tags = computed<Tag[]>(() => tagComposable?.getTags() ?? [])

const acmgOptions = ACMG_CLASSIFICATIONS.map((value) => ({
  value,
  title: value,
  short: ACMG_ABBREV[value],
  color: ACMG_COLORS[value]
}))
</script>

<style scoped>
.bulk-triage-action-bar {
  position: absolute;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  background-color: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.tag-color-dot {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  display: inline-block;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease-out;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translate(-50%, 1rem);
  opacity: 0;
}
</style>
