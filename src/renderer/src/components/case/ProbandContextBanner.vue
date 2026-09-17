<template>
  <div class="proband-context-banner d-flex align-center px-3 py-1 ga-2">
    <v-icon size="16" color="primary" :icon="probandSexIcon" />
    <span class="text-caption font-weight-bold text-high-emphasis text-truncate">
      {{ caseName }}
    </span>
    <span v-if="probandDetails" class="text-caption text-medium-emphasis">
      ({{ probandDetails }})
    </span>
    <v-divider vertical class="mx-1 my-1" />
    <div class="d-flex align-center ga-1 overflow-hidden flex-grow-1">
      <v-chip
        v-for="term in displayedHpoTerms"
        :key="term.hpo_id"
        size="x-small"
        variant="tonal"
        color="primary"
        class="text-caption font-weight-medium"
      >
        {{ term.hpo_label || term.hpo_id }}
      </v-chip>
      <v-tooltip v-if="overflowHpoCount > 0" location="bottom">
        <template #activator="{ props: tooltipProps }">
          <v-chip
            v-bind="tooltipProps"
            size="x-small"
            variant="text"
            class="text-caption text-medium-emphasis"
          >
            +{{ overflowHpoCount }} more
          </v-chip>
        </template>
        <div class="text-caption">
          <div v-for="t in overflowHpoTerms" :key="t.hpo_id">{{ t.hpo_id }}: {{ t.hpo_label }}</div>
        </div>
      </v-tooltip>
      <span v-if="displayedHpoTerms.length === 0" class="text-caption text-disabled font-italic">
        No clinical phenotypes recorded
      </span>
    </div>
    <v-btn
      size="x-small"
      variant="text"
      density="compact"
      color="primary"
      :icon="mdiPencilOutline"
      aria-label="Edit Case Phenotypes and Metadata"
      @click="$emit('edit')"
    >
      <v-icon size="14" :icon="mdiPencilOutline" />
      <v-tooltip activator="parent" location="bottom">Edit clinical metadata & HPO</v-tooltip>
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import {
  mdiGenderMale,
  mdiGenderFemale,
  mdiGenderNonBinary,
  mdiPencilOutline,
  mdiAccount
} from '@mdi/js'
import { useCaseMetadata } from '../../composables/useCaseMetadata'

const props = defineProps<{
  caseId: number
  caseName: string
}>()

defineEmits<{
  edit: []
}>()

const { getMetadata, loadMetadata } = useCaseMetadata()

watch(
  () => props.caseId,
  (id) => {
    if (id) {
      void loadMetadata(id)
    }
  },
  { immediate: true }
)

const currentFullMeta = computed(() => (props.caseId ? getMetadata(props.caseId) : undefined))

const probandSex = computed(() => currentFullMeta.value?.metadata?.sex ?? null)
const probandSexIcon = computed(() => {
  if (probandSex.value === 'male') return mdiGenderMale
  if (probandSex.value === 'female') return mdiGenderFemale
  if (probandSex.value === 'other') return mdiGenderNonBinary
  return mdiAccount
})

const probandAge = computed(() => {
  const age = currentFullMeta.value?.metadata?.age
  if (age == null) return null
  return `${age}y`
})

const probandStatus = computed(() => currentFullMeta.value?.metadata?.affected_status ?? null)

const probandDetails = computed(() => {
  const parts: string[] = []
  if (probandSex.value !== null && probandSex.value !== 'unknown') {
    parts.push(probandSex.value)
  }
  if (probandAge.value !== null && probandAge.value !== '') {
    parts.push(probandAge.value)
  }
  if (probandStatus.value !== null && probandStatus.value !== 'unknown') {
    parts.push(probandStatus.value)
  }
  return parts.join(', ')
})

const observedHpoTerms = computed(() => {
  return currentFullMeta.value?.hpoTerms ?? []
})

const displayedHpoTerms = computed(() => observedHpoTerms.value.slice(0, 3))
const overflowHpoTerms = computed(() => observedHpoTerms.value.slice(3))
const overflowHpoCount = computed(() => Math.max(0, observedHpoTerms.value.length - 3))
</script>

<style scoped>
.proband-context-banner {
  min-height: 32px;
  background-color: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 3%, transparent);
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  flex-shrink: 0;
}
</style>
