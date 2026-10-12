<template>
  <div>
    <v-text-field
      :model-value="stripText"
      label="Remove from names"
      placeholder="e.g. _results, LB24-"
      variant="outlined"
      density="compact"
      clearable
      hide-details
      class="mb-3"
      :prepend-inner-icon="mdiTextSearchVariant"
      @update:model-value="$emit('update:stripText', $event)"
    />

    <v-alert v-if="duplicateCount > 0" type="warning" variant="tonal" class="mb-3">
      {{ duplicateCount }} of {{ fileCount }} files already exist as cases.
    </v-alert>

    <div v-if="duplicateCount > 0">
      <v-radio-group
        :model-value="duplicateStrategy"
        class="mb-3"
        hide-details
        @update:model-value="$emit('update:duplicateStrategy', $event as DuplicateChoice)"
      >
        <v-radio value="skip" color="primary">
          <template #label>
            <div>
              <strong>Skip duplicates</strong>
              <div class="text-body-small text-medium-emphasis">
                Only import new files, leave existing cases unchanged
              </div>
            </div>
          </template>
        </v-radio>
        <v-radio value="overwrite" color="warning">
          <template #label>
            <div>
              <strong>Overwrite duplicates</strong>
              <div class="text-body-small text-medium-emphasis">
                Replace existing cases with data from the selected files. The annotations of the
                replaced cases (ACMG classifications, stars, comments, tags) are deleted.
              </div>
            </div>
          </template>
        </v-radio>
      </v-radio-group>
      <v-divider class="mb-3" />
    </div>

    <div class="text-body-small text-medium-emphasis mb-1" data-testid="batch-build-tally">
      {{ buildTally }}
    </div>
    <div
      v-for="file in unimportable"
      :key="file.fileName"
      class="text-body-small text-error mb-1"
      data-testid="batch-build-skipped"
    >
      {{ file.fileName }}: {{ file.reason }}
    </div>
    <GenomeBuildField
      v-if="withoutBuild.length > 0"
      ref="fallbackField"
      :model-value="fallbackBuild"
      :detection="NO_DETECTION"
      :label="BUILD_COPY.fallbackLabel"
      :empty-hint="allJson ? BUILD_COPY.json : BUILD_COPY.none"
      class="mb-2"
      @update:model-value="$emit('update:fallbackBuild', $event)"
    />

    <div class="text-body-small text-medium-emphasis mb-2">
      {{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }} to import:
    </div>
    <v-list density="compact" class="pa-0" max-height="300" style="overflow-y: auto">
      <v-list-item
        v-for="(file, i) in reviewFiles"
        :key="i"
        :class="file.isDuplicate ? 'text-warning' : ''"
      >
        <template #prepend>
          <v-icon
            v-if="file.isDuplicate"
            color="warning"
            size="small"
            :icon="mdiAlertCircleOutline"
          />
          <v-icon v-else color="success" size="small" :icon="mdiNewBox" />
        </template>
        <v-list-item-title class="text-body-medium">
          {{ file.caseName }}
          <span v-if="file.isDuplicate" class="text-body-small text-warning ml-1"> (exists) </span>
          <span
            v-if="file.build?.confidence === 'definitive' || file.build?.confidence === 'strong'"
            class="text-body-small text-medium-emphasis ml-1"
          >
            · {{ file.build.suggested }}
          </span>
        </v-list-item-title>
        <v-list-item-subtitle v-if="file.caseName !== file.fileName" class="text-body-small">
          {{ file.fileName }}
        </v-list-item-subtitle>
      </v-list-item>
    </v-list>

    <v-alert v-if="hasEmptyCaseNames" type="error" variant="tonal" density="compact" class="mt-3">
      Some case names are empty after stripping. Adjust the text to remove.
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DuplicateCheckItem, DuplicateChoice } from '../../../../shared/types/api'
import { mdiAlertCircleOutline, mdiNewBox, mdiTextSearchVariant } from '@mdi/js'
import { BUILD_COPY, GENOME_BUILDS } from '../../../../shared/config/genome-builds.config'
import type { BuildDetection } from '../../../../shared/genome/genome-build'
import GenomeBuildField from '../import/GenomeBuildField.vue'

const props = defineProps<{
  reviewFiles: Array<Pick<DuplicateCheckItem, 'caseName' | 'fileName' | 'isDuplicate' | 'build'>>
  fileCount: number
  duplicateCount: number
  duplicateStrategy: DuplicateChoice
  stripText: string
  hasEmptyCaseNames: boolean
  /** The build for files whose header decides none (always JSON). */
  fallbackBuild: string | null
}>()

defineEmits<{
  'update:duplicateStrategy': [value: DuplicateChoice]
  'update:stripText': [value: string | null]
  'update:fallbackBuild': [value: string]
}>()

const NO_DETECTION: BuildDetection = {
  suggested: null,
  confidence: 'none',
  evidence: [],
  excluded: []
}
const fallbackField = ref<InstanceType<typeof GenomeBuildField> | null>(null)

// In a batch the tally is the confirmation: each VCF that decides its build keeps it.
const decided = computed(() =>
  props.reviewFiles.filter(
    (f) => f.build?.confidence === 'definitive' || f.build?.confidence === 'strong'
  )
)
const withoutBuild = computed(() =>
  props.reviewFiles.filter((f) => (f.build?.confidence ?? 'none') === 'none')
)
const allJson = computed(() => withoutBuild.value.every((f) => /\.json(\.gz)?$/i.test(f.fileName)))
const unimportable = computed(() =>
  props.reviewFiles.flatMap((f) => {
    const def = GENOME_BUILDS.find((b) => b.id === f.build?.suggested)
    if (def !== undefined && !def.importable) {
      return [{ fileName: f.fileName, reason: BUILD_COPY.notImportable(def.label) }]
    }
    return f.build?.confidence === 'conflict'
      ? [{ fileName: f.fileName, reason: BUILD_COPY.skippedConflict }]
      : []
  })
)
const buildTally = computed(() => {
  const counts = GENOME_BUILDS.map((b) => ({
    build: b.id,
    count: decided.value.filter(
      (f) => f.build?.confidence === 'definitive' && f.build.suggested === b.id
    ).length
  })).filter((c) => c.count > 0)
  const tagOnly = decided.value.filter((f) => f.build?.confidence === 'strong').length
  return BUILD_COPY.tally(counts, tagOnly, withoutBuild.value.length)
})

/** False (with the fallback field's inline error) while files without a build have no choice. */
function validate(): boolean {
  return withoutBuild.value.length === 0 || (fallbackField.value?.validate() ?? false)
}
defineExpose({ validate })
</script>
