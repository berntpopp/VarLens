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

      <!-- Genome build -->
      <v-select
        v-model="selectedGenomeBuild"
        :items="genomeBuildOptions"
        label="Genome Build"
        variant="outlined"
        density="compact"
        class="mb-4"
        hint="Auto-detected from VCF header. Override if incorrect."
        persistent-hint
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
            :model-value="caseNames.get(sample) || sample"
            label="Case name"
            variant="outlined"
            density="compact"
            hide-details
            class="flex-grow-1"
            @update:model-value="setCaseName(sample, $event)"
          />
        </div>
      </div>

      <!-- INFO field mappings (collapsible) -->
      <v-expansion-panels variant="accordion" class="mb-4">
        <v-expansion-panel>
          <v-expansion-panel-title class="text-body-2">
            INFO Fields ({{ preview.infoFields.length }})
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-table density="compact">
              <thead>
                <tr>
                  <th class="text-left">Field</th>
                  <th class="text-left">Type</th>
                  <th class="text-left">Maps To</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="field in preview.infoFields" :key="field.id">
                  <td class="text-body-2">{{ field.id }}</td>
                  <td class="text-body-2">{{ field.type }}({{ field.number }})</td>
                  <td>
                    <v-chip
                      v-if="field.mapsToColumn"
                      size="x-small"
                      color="success"
                      variant="tonal"
                      label
                    >
                      {{ field.mapsToColumn }}
                    </v-chip>
                    <v-chip v-else size="x-small" color="grey" variant="tonal" label>
                      info_json
                    </v-chip>
                  </td>
                </tr>
              </tbody>
            </v-table>
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
import type { VcfPreviewResult } from '../../../../main/import/vcf/types'

const props = defineProps<{
  filePath: string
}>()

const emit = defineEmits<{
  'preview-loaded': [preview: VcfPreviewResult]
  'selection-changed': [
    options: {
      selectedSamples: string[]
      genomeBuild: string
      caseNames: Map<string, string>
    }
  ]
}>()

const { api } = useApiService()

const loading = ref(true)
const error = ref<string | null>(null)
const preview = ref<VcfPreviewResult | null>(null)

const selectedSamples = ref<string[]>([])
const selectedGenomeBuild = ref('GRCh38')
const caseNames = ref(new Map<string, string>())

const genomeBuildOptions = ['GRCh38', 'GRCh37']

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

function emitSelection(): void {
  emit('selection-changed', {
    selectedSamples: [...selectedSamples.value],
    genomeBuild: selectedGenomeBuild.value,
    caseNames: new Map(caseNames.value)
  })
}

watch(selectedGenomeBuild, () => {
  emitSelection()
})

onMounted(async () => {
  try {
    loading.value = true
    error.value = null

    const result = await api!.import.vcfPreview(props.filePath)
    preview.value = result as VcfPreviewResult

    // Default: select all samples
    selectedSamples.value = [...preview.value.samples]
    for (const sample of preview.value.samples) {
      caseNames.value.set(sample, sample)
    }

    // Set detected genome build
    if (preview.value.detectedGenomeBuild !== null && preview.value.detectedGenomeBuild !== '') {
      selectedGenomeBuild.value = preview.value.detectedGenomeBuild
    }

    emit('preview-loaded', preview.value)
    emitSelection()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    logService.error(`VCF preview failed: ${error.value}`, 'VcfPreviewStep')
  } finally {
    loading.value = false
  }
})
</script>
