<template>
  <div ref="root" class="genome-build-field" :class="{ 'genome-build-field--warn': warn }">
    <v-radio-group
      :model-value="modelValue"
      :label="label ?? BUILD_COPY.fieldLabel"
      inline
      density="compact"
      :messages="invalid ? undefined : hint"
      :error-messages="invalid ? errorText : undefined"
      data-testid="genome-build-field"
      @update:model-value="onPick"
    >
      <v-radio
        v-for="build in IMPORTABLE_GENOME_BUILDS"
        :key="build.id"
        :value="build.id"
        :label="optionLabel(build.id, build.label)"
        color="primary"
      />
      <template v-if="evidenceLines.length > 0" #append>
        <v-tooltip location="top" max-width="420">
          <template #activator="{ props: tip }">
            <v-btn
              v-bind="tip"
              :icon="mdiInformationOutline"
              :aria-label="BUILD_COPY.evidenceLabel"
              variant="text"
              size="x-small"
              density="comfortable"
            />
          </template>
          <div v-for="(line, i) in evidenceLines" :key="i">{{ line }}</div>
        </v-tooltip>
      </template>
    </v-radio-group>
    <div
      v-if="detection.mitoWarning"
      class="text-body-small text-warning"
      data-testid="genome-build-mito-warning"
    >
      {{ detection.mitoWarning }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { mdiInformationOutline } from '@mdi/js'
import {
  BUILD_COPY,
  IMPORTABLE_GENOME_BUILDS
} from '../../../../shared/config/genome-builds.config'
import {
  describeBuildDetection,
  isBuildImportBlocked,
  type BuildDetection
} from '../../../../shared/genome/genome-build'

const props = defineProps<{
  detection: BuildDetection
  modelValue: string | null
  label?: string
  /** Replaces the "nothing found" copy (e.g. for JSON). */
  emptyHint?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const root = ref<HTMLElement | null>(null)
const touched = ref(false)

const blocked = computed(() => isBuildImportBlocked(props.detection))
const definitive = computed(() =>
  props.detection.confidence === 'definitive' ? props.detection.suggested : null
)
const excludedIds = computed(() => new Set(props.detection.excluded.map((e) => e.build)))
const warn = computed(
  () =>
    !blocked.value &&
    definitive.value !== null &&
    props.modelValue !== null &&
    props.modelValue !== definitive.value
)
const hint = computed(() => {
  if (warn.value) return BUILD_COPY.override(definitive.value!, props.modelValue!)
  if (props.emptyHint !== undefined && props.detection.confidence === 'none') return props.emptyHint
  return describeBuildDetection(props.detection)
})
const invalid = computed(() => blocked.value || (touched.value && props.modelValue === null))
const errorText = computed(() => (blocked.value ? hint.value : BUILD_COPY.required))
const evidenceLines = computed(() => [
  ...props.detection.evidence.map((e) => `${e.source}: ${e.detail}`),
  ...props.detection.excluded.map((e) => `Not ${e.build} (${e.source}): ${e.detail}`)
])

function optionLabel(id: string, label: string): string {
  if (definitive.value === null && props.detection.suggested === id) {
    return label + BUILD_COPY.suggestedSuffix
  }
  // Blocked (mixed files, non-importable): the error says why; per-option marks add noise.
  return !blocked.value && excludedIds.value.has(id) ? label + BUILD_COPY.excludedSuffix : label
}

function onPick(value: unknown): void {
  if (typeof value === 'string') emit('update:modelValue', value)
}

/** Call before import: false (and focus the group) while no build is confirmed or import is blocked. */
function validate(): boolean {
  touched.value = true
  const ok = !blocked.value && props.modelValue !== null
  if (!ok) root.value?.querySelector<HTMLElement>('input[type="radio"]')?.focus()
  return ok
}

onMounted(() => {
  // Only contig lengths are strong enough to pre-select; otherwise the click confirms.
  if (props.modelValue === null && definitive.value !== null && !blocked.value) {
    emit('update:modelValue', definitive.value)
  }
})

defineExpose({ validate })
</script>

<style scoped>
.genome-build-field--warn :deep(.v-messages) {
  color: rgb(var(--v-theme-warning));
  opacity: 1;
}
</style>
