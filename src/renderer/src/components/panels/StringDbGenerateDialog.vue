<template>
  <v-dialog
    :model-value="modelValue"
    max-width="600"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>Generate from StringDB</span>
        <v-spacer />
        <v-btn aria-label="Close" :icon="mdiClose" variant="text" size="small" @click="close" />
      </v-card-title>

      <v-card-text>
        <!-- Seed genes input -->
        <v-textarea
          v-model="seedGenesText"
          label="Seed genes (one per line, or comma/semicolon separated)"
          variant="outlined"
          density="compact"
          rows="4"
          hide-details
          class="mb-2"
          placeholder="BRCA1&#10;BRCA2&#10;TP53"
        />
        <div class="text-caption text-medium-emphasis mb-3">
          {{ parsedGenes.length }} gene{{ parsedGenes.length !== 1 ? 's' : '' }} parsed
        </div>

        <!-- Preset selector -->
        <div class="text-body-2 mb-2">Presets</div>
        <v-chip-group v-model="selectedPreset" class="mb-3">
          <v-chip value="high" color="success" filter> High-confidence physical </v-chip>
          <v-chip value="medium" color="warning" filter> Medium functional </v-chip>
          <v-chip value="broad" color="orange" filter> Broad exploration </v-chip>
        </v-chip-group>

        <!-- Custom controls (shown when no preset selected) -->
        <template v-if="!selectedPreset">
          <div class="text-body-2 mb-1">Score threshold: {{ requiredScore }}</div>
          <v-slider
            v-model="requiredScore"
            :min="0"
            :max="1000"
            :step="50"
            color="primary"
            hide-details
            class="mb-3"
          />

          <div class="text-body-2 mb-1">Network type</div>
          <v-btn-toggle
            v-model="networkType"
            mandatory
            density="compact"
            color="primary"
            class="mb-3"
          >
            <v-btn value="physical" size="small">Physical</v-btn>
            <v-btn value="functional" size="small">Functional</v-btn>
          </v-btn-toggle>
        </template>

        <!-- Panel name -->
        <v-text-field
          v-model="panelName"
          label="Panel name (optional)"
          variant="outlined"
          density="compact"
          hide-details
          class="mb-3"
          placeholder="Auto-generated if empty"
        />

        <!-- Error alert -->
        <v-alert v-if="errorMessage" type="error" variant="tonal" density="compact" class="mb-3">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancel</v-btn>
        <v-btn
          color="orange"
          variant="flat"
          :disabled="parsedGenes.length === 0 || generating"
          :loading="generating"
          @click="doGenerate"
        >
          Generate
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { mdiClose } from '@mdi/js'
import { useApiService } from '../../composables/useApiService'
import { useCapabilityStore } from '../../stores/capabilityStore'
import { useGeneValidation } from '../../composables/useGeneValidation'
import { isIpcError, unwrapIpcResult } from '../../../../shared/types/errors'

interface Preset {
  score: number
  network: 'physical' | 'functional'
}

const PRESETS: Record<string, Preset> = {
  high: { score: 700, network: 'physical' },
  medium: { score: 400, network: 'functional' },
  broad: { score: 150, network: 'functional' }
}

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  generated: []
}>()

const { api } = useApiService()
const { capabilityReason } = useCapabilityStore()
const { parseGeneText } = useGeneValidation()

// Input state
const seedGenesText = ref('')
const selectedPreset = ref<string | undefined>(undefined)
const requiredScore = ref(400)
const networkType = ref<'physical' | 'functional'>('physical')
const panelName = ref('')

// Generate state
const generating = ref(false)
const errorMessage = ref('')

// Parse genes from textarea (deduplicated via useGeneValidation)
const parsedGenes = computed<string[]>(() => parseGeneText(seedGenesText.value))

// Effective score and network type (preset overrides custom)
const effectiveScore = computed(() => {
  const key = selectedPreset.value
  if (key !== undefined && key !== '' && key in PRESETS) {
    return PRESETS[key].score
  }
  return requiredScore.value
})

const effectiveNetworkType = computed(() => {
  const key = selectedPreset.value
  if (key !== undefined && key !== '' && key in PRESETS) {
    return PRESETS[key].network
  }
  return networkType.value
})

// Reset state when dialog opens
watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      seedGenesText.value = ''
      selectedPreset.value = undefined
      requiredScore.value = 400
      networkType.value = 'physical'
      panelName.value = ''
      errorMessage.value = ''
    }
  }
)

async function doGenerate(): Promise<void> {
  if (!api || parsedGenes.value.length === 0) return
  // STRING is an external lookup (parity manifest): explain instead of calling.
  const unavailable = capabilityReason('stringDbPanels')
  if (unavailable !== null) {
    errorMessage.value = unavailable
    return
  }

  generating.value = true
  errorMessage.value = ''
  try {
    unwrapIpcResult(
      await api.panels.generateStringDb({
        seedGenes: parsedGenes.value,
        requiredScore: effectiveScore.value,
        networkType: effectiveNetworkType.value,
        name: panelName.value.trim() || undefined
      })
    )
    emit('generated')
    close()
  } catch (e) {
    errorMessage.value =
      e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
  } finally {
    generating.value = false
  }
}

function close(): void {
  emit('update:modelValue', false)
}
</script>
