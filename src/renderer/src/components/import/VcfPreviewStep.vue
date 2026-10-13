<template>
  <div>
    <!-- Loading state -->
    <div v-if="loading" class="d-flex justify-center align-center pa-8">
      <v-progress-circular indeterminate color="primary" />
      <span class="ml-3 text-body-2">Analyzing VCF file...</span>
    </div>

    <!-- Error state -->
    <v-alert v-else-if="error" type="error" variant="tonal" class="mb-3">
      {{ error }}
    </v-alert>

    <!-- Preview content -->
    <div v-else-if="preview">
      <!-- File info -->
      <div class="text-caption text-medium-emphasis mb-2">File Information</div>
      <div class="d-flex flex-wrap ga-2 mb-4">
        <v-chip size="small" label variant="tonal" color="primary">
          {{ preview.fileformat }}
        </v-chip>
        <v-chip size="small" label variant="tonal" :color="annotationColor">
          {{ annotationLabel }}
        </v-chip>
        <v-chip size="small" label variant="tonal">
          ~{{ preview.variantCountEstimate.toLocaleString() }} variants
        </v-chip>
      </div>

      <GenomeBuildField
        ref="buildField"
        v-model="selectedGenomeBuild"
        :detection="preview.buildDetection"
        class="mb-4"
      />

      <!-- Sample selection -->
      <div class="text-caption text-medium-emphasis mb-2">
        Samples ({{ selectedSamples.length }}/{{ preview.samples.length }} selected)
      </div>
      <div v-if="preview.samples.length === 0" class="text-body-2 text-medium-emphasis mb-4">
        No samples found (sites-only VCF)
      </div>
      <div v-else class="mb-4">
        <div v-for="sample in preview.samples" :key="sample" class="d-flex align-center ga-2 mb-2">
          <v-checkbox
            :model-value="selectedSamples.includes(sample)"
            :label="sample"
            density="compact"
            hide-details
            @update:model-value="toggleSample(sample, $event)"
          />
          <v-text-field
            v-if="selectedSamples.includes(sample)"
            :model-value="caseNames.get(sample) ?? sample"
            :aria-label="`Case name for ${sample}`"
            :data-testid="`vcf-case-name-${sample}`"
            :error-messages="caseNameErrors(sample)"
            label="Case name"
            name="caseName"
            variant="outlined"
            density="compact"
            hide-details="auto"
            class="flex-grow-1"
            @update:model-value="setCaseName(sample, $event)"
          />
        </div>
      </div>

      <!-- Annotation fields: where each INFO / CSQ / ANN field goes (spec §16) -->
      <v-expansion-panels variant="accordion" class="mb-4">
        <v-expansion-panel>
          <v-expansion-panel-title class="text-body-2">
            Annotation fields ({{ previewFields.length }})
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <ImportFieldProfileTable
              v-model="fieldProfile"
              :fields="previewFields"
              :readonly="!canWrite"
              can-save-default
            />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useApiService } from '../../composables/useApiService'
import { logService } from '../../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../../shared/types/errors'
import type { VcfPreviewResult, VcfSampleSelection } from '../../../../shared/types/vcf'
import type { ImportFieldProfile } from '../../../../shared/config/import-fields.config'
import { usePermissions } from '../../composables/usePermissions'
import { vcfPreviewFields } from '../../utils/import-field-rows'
import ImportFieldProfileTable from './ImportFieldProfileTable.vue'
import { CASE_NAME_MESSAGES } from '../../config/importConfig'
import GenomeBuildField from './GenomeBuildField.vue'

const props = defineProps<{
  filePath: string
}>()

const emit = defineEmits<{
  'preview-loaded': [preview: VcfPreviewResult]
  'selection-changed': [options: VcfSampleSelection]
}>()

const fieldProfile = defineModel<ImportFieldProfile>('fieldProfile', { required: true })

const { api } = useApiService()
const { canWrite } = usePermissions()

const loading = ref(true)
const error = ref<string | null>(null)
const preview = ref<VcfPreviewResult | null>(null)

const selectedSamples = ref<string[]>([])
// Never defaulted: pre-selected by GenomeBuildField only for definitive evidence.
const selectedGenomeBuild = ref<string | null>(null)
const caseNames = ref(new Map<string, string>())
/** Names of the cases already in the database, to flag a clash before import. */
const existingCaseNames = ref(new Set<string>())
const buildField = ref<InstanceType<typeof GenomeBuildField> | null>(null)

const previewFields = computed(() => (preview.value ? vcfPreviewFields(preview.value) : []))

/** False (with the field's inline error) until the user has confirmed a build. */
function validate(): boolean {
  return buildField.value?.validate() ?? false
}
defineExpose({ validate })

const annotationLabel = computed(() => {
  if (!preview.value) return ''
  switch (preview.value.annotationType) {
    case 'csq':
      return 'VEP (CSQ)'
    case 'ann':
      return 'SnpEff (ANN)'
    case 'none':
      return 'Unannotated'
    default:
      return 'Unknown'
  }
})

const annotationColor = computed(() => {
  if (!preview.value) return 'grey'
  return preview.value.annotationType === 'none' ? 'grey' : 'success'
})

function toggleSample(sample: string, checked: unknown): void {
  if (checked === true) {
    if (!selectedSamples.value.includes(sample)) {
      selectedSamples.value.push(sample)
      if (!caseNames.value.has(sample)) {
        caseNames.value.set(sample, sample)
      }
    }
  } else {
    selectedSamples.value = selectedSamples.value.filter((s) => s !== sample)
  }
  emitSelection()
}

function setCaseName(sample: string, name: unknown): void {
  caseNames.value.set(sample, String(name))
  emitSelection()
}

function caseNameOf(sample: string): string {
  return (caseNames.value.get(sample) ?? sample).trim()
}

function caseNameErrors(sample: string): string[] {
  const name = caseNameOf(sample)
  if (name === '') return [CASE_NAME_MESSAGES.REQUIRED]
  if (existingCaseNames.value.has(name)) return [CASE_NAME_MESSAGES.EXISTS(name)]
  const sameName = selectedSamples.value.filter((s) => caseNameOf(s) === name)
  return sameName.length > 1 ? [CASE_NAME_MESSAGES.REPEATED] : []
}

function emitSelection(): void {
  emit('selection-changed', {
    selectedSamples: [...selectedSamples.value],
    genomeBuild: selectedGenomeBuild.value,
    caseNames: new Map(caseNames.value),
    valid: selectedSamples.value.every((s) => caseNameErrors(s).length === 0)
  })
}

watch(selectedGenomeBuild, () => {
  emitSelection()
})

onMounted(async () => {
  try {
    loading.value = true
    error.value = null

    const [result, cases] = await Promise.all([
      api!.import.vcfPreview(props.filePath),
      api!.cases.list().catch(() => null)
    ])
    preview.value = unwrapIpcResult(result)
    // The server still refuses a clash; failing to list cases only loses the early hint.
    if (Array.isArray(cases)) existingCaseNames.value = new Set(cases.map((c) => c.name))

    // Default: select all samples
    selectedSamples.value = [...preview.value.samples]
    for (const sample of preview.value.samples) {
      caseNames.value.set(sample, sample)
    }

    emit('preview-loaded', preview.value)
    emitSelection()
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : isIpcError(err)
          ? (err.userMessage ?? err.message)
          : String(err)
    logService.error(`VCF preview failed: ${error.value}`, 'VcfPreviewStep')
  } finally {
    loading.value = false
  }
})
</script>
