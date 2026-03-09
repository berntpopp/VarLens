<template>
  <!-- Classification Result Banner -->
  <v-alert
    v-if="effectiveClassification"
    :color="ACMG_COLORS[effectiveClassification]"
    variant="tonal"
    density="compact"
    class="mb-3 classification-banner"
  >
    <div class="d-flex align-center justify-space-between">
      <div class="d-flex align-center ga-2">
        <v-chip
          :color="ACMG_COLORS[effectiveClassification]"
          size="small"
          label
          variant="elevated"
          class="font-weight-bold"
        >
          {{ effectiveClassification }}
        </v-chip>
        <span class="text-caption font-weight-medium">
          {{ classificationResult.netPoints }} net pts
        </span>
      </div>
      <v-tooltip location="bottom">
        <template #activator="{ props: tooltipProps }">
          <v-icon v-bind="tooltipProps" size="x-small">mdi-information-outline</v-icon>
        </template>
        <div class="text-caption">
          Pathogenic: +{{ classificationResult.pathogenicPoints }}<br />
          Benign: -{{ classificationResult.benignPoints }}<br />
          Net: {{ classificationResult.netPoints }}
        </div>
      </v-tooltip>
    </div>
    <div v-if="isOverride" class="text-caption mt-1">
      <v-icon size="x-small" color="warning">mdi-alert</v-icon>
      Override — calculated: {{ classificationResult.classification ?? 'none' }}
    </div>
  </v-alert>

  <!-- Empty state hint -->
  <div v-else class="empty-state-hint text-caption text-medium-emphasis mb-2 pa-2">
    <v-icon size="x-small" class="mr-1">mdi-information-outline</v-icon>
    Select evidence codes below to classify this variant
  </div>

  <!-- Actions Row -->
  <div class="d-flex ga-1 mb-3">
    <v-btn
      v-if="showAutoSuggest"
      variant="tonal"
      size="x-small"
      density="compact"
      color="amber-darken-2"
      prepend-icon="mdi-lightbulb-on"
      @click="$emit('autoSuggest')"
    >
      Auto-suggest
    </v-btn>
    <v-menu v-if="effectiveClassification || hasActiveCodes" location="bottom">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          variant="tonal"
          size="x-small"
          density="compact"
          color="grey-darken-1"
          prepend-icon="mdi-pencil"
        >
          Override
        </v-btn>
      </template>
      <v-list density="compact" nav>
        <v-list-item
          v-for="cls in ACMG_CLASSIFICATIONS"
          :key="cls"
          :active="isOverride && overrideClassification === cls"
          @click="$emit('override', cls)"
        >
          <template #prepend>
            <v-icon :color="ACMG_COLORS[cls]" size="small">mdi-circle</v-icon>
          </template>
          <v-list-item-title class="text-caption">{{ cls }}</v-list-item-title>
        </v-list-item>
        <v-divider v-if="isOverride" />
        <v-list-item v-if="isOverride" @click="$emit('override', null)">
          <v-list-item-title class="text-caption text-medium-emphasis">
            Clear override
          </v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import type { AcmgClassification } from '../../../../main/database/types'
import { ACMG_COLORS, ACMG_CLASSIFICATIONS } from '../../composables/useAnnotations'

interface ClassificationResult {
  classification: AcmgClassification | null
  pathogenicPoints: number
  benignPoints: number
  netPoints: number
}

defineProps<{
  effectiveClassification: AcmgClassification | null
  classificationResult: ClassificationResult
  isOverride: boolean
  overrideClassification: AcmgClassification | null
  showAutoSuggest: boolean
  hasActiveCodes: boolean
}>()

defineEmits<{
  autoSuggest: []
  override: [classification: AcmgClassification | null]
}>()
</script>

<style scoped>
.classification-banner :deep(.v-alert__content) {
  width: 100%;
}

.empty-state-hint {
  border: 1px dashed rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  text-align: center;
}
</style>
