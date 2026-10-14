<template>
  <div class="proband-context-banner d-flex align-center px-3 py-1 ga-2">
    <v-icon size="16" color="primary" :icon="probandSexIcon" />
    <span class="text-caption font-weight-bold text-high-emphasis text-truncate">
      {{ caseName }}
    </span>
    <span v-if="probandDetails" class="text-caption text-medium-emphasis text-no-wrap">
      ({{ probandDetails }})
    </span>
    <v-divider vertical class="mx-1 my-1" />
    <div class="d-flex align-center ga-1 overflow-hidden flex-grow-1">
      <v-chip
        v-for="term in displayedHpoTerms"
        :key="term.hpo_id"
        size="x-small"
        variant="tonal"
        :color="term.excluded ? 'error' : 'primary'"
        :prepend-icon="hpoTermIcon(term)"
        :class="term.key ? 'font-weight-bold' : 'font-weight-medium'"
        class="text-caption"
        :aria-label="hpoTermAriaLabel(term)"
      >
        <!-- One inline span: a flex chip would trim the space after "no". -->
        <span
          >{{ term.excluded ? COPY.excludedPrefix : ''
          }}<span :class="{ 'text-decoration-line-through': term.excluded }">{{
            hpoTermLabel(term)
          }}</span></span
        >
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
          <div v-for="line in overflowLines" :key="line">{{ line }}</div>
        </div>
      </v-tooltip>
      <span
        v-if="emptyNote !== null"
        class="text-caption text-muted font-italic text-truncate"
        data-testid="banner-phenotype-empty"
      >
        {{ emptyNote }}
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
import { HPO_TERM_COPY as COPY } from '../../config/hpoTermCopy'
import {
  groupedHpoTermLines,
  hpoTermAriaLabel,
  hpoTermIcon,
  hpoTermLabel,
  orderHpoTerms
} from '../../utils/hpo-term-status'

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

const orderedHpoTerms = computed(() => orderHpoTerms(currentFullMeta.value?.hpoTerms ?? []))

const displayedHpoTerms = computed(() => orderedHpoTerms.value.slice(0, 3))
const overflowLines = computed(() => groupedHpoTermLines(orderedHpoTerms.value.slice(3)))
const overflowHpoCount = computed(() => Math.max(0, orderedHpoTerms.value.length - 3))
/** Excluded terms alone do not drive the phenotype score, so say it is inactive. */
const emptyNote = computed(() => {
  if (orderedHpoTerms.value.length === 0) return COPY.bannerEmpty
  return orderedHpoTerms.value.every((t) => t.excluded) ? COPY.bannerOnlyExcluded : null
})
</script>

<style scoped>
.proband-context-banner {
  min-height: 32px;
  background-color: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 3%, transparent);
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  flex-shrink: 0;
  /* One line at every width: a banner that wraps for some cases changes
     height on case switch and shifts the table below it. */
  flex-wrap: nowrap;
}
</style>
