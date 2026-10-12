<template>
  <div class="d-flex ga-1 flex-wrap mb-2">
    <v-chip
      v-for="preset in CARRIER_FREQUENCY_PRESETS"
      :key="preset.value"
      :color="selectedPreset === preset.value ? 'primary' : undefined"
      :variant="selectedPreset === preset.value ? 'flat' : 'outlined'"
      size="small"
      label
      @click="selectedPreset = selectedPreset === preset.value ? null : preset.value"
    >
      {{ preset.label }}
    </v-chip>
  </div>
  <v-text-field
    v-model="customPercent"
    density="compact"
    variant="outlined"
    :hint="CARRIER_FREQUENCY_COPY.hint"
    persistent-hint
    type="number"
    step="0.1"
    min="0"
    max="100"
    :placeholder="CARRIER_FREQUENCY_COPY.placeholder"
    clearable
    suffix="%"
    @click:clear="customPercent = ''"
  />
</template>

<script setup lang="ts">
/**
 * Max cohort carrier frequency (`maxInternalAf`, a fraction): preset chips or
 * a custom percentage. One control for the case and the cohort drawer (#555).
 */
import { ref, watch } from 'vue'
import { CARRIER_FREQUENCY_COPY, CARRIER_FREQUENCY_PRESETS } from '../../config/uiCopyConfig'

const model = defineModel<number | null>({ required: true })

const selectedPreset = ref<number | null>(null)
const customPercent = ref<string>('')

// Preset selection sets the filter and clears the custom input.
watch(selectedPreset, (val) => {
  if (val !== null) {
    model.value = val
    customPercent.value = ''
  } else if (customPercent.value === '') {
    model.value = null
  }
})

// Custom input sets the filter and clears the preset.
watch(customPercent, (val) => {
  const num = parseFloat(val)
  if (val !== '' && !Number.isNaN(num) && num > 0) {
    model.value = Math.min(num, 100) / 100
    selectedPreset.value = null
  } else if (val === '' && selectedPreset.value === null) {
    model.value = null
  }
})

// Filter changed elsewhere ("Clear all", a loaded preset): show it here.
watch(model, (val) => {
  if (val === null || val === 0) {
    selectedPreset.value = null
    customPercent.value = ''
  } else if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    const preset = CARRIER_FREQUENCY_PRESETS.find((p) => p.value === val)
    selectedPreset.value = preset?.value ?? null
    // Keep what was typed; toPrecision drops float noise (0.07 * 100 = 7.000000000000001).
    if (preset) customPercent.value = ''
    else if (Math.min(parseFloat(customPercent.value), 100) / 100 !== val)
      customPercent.value = String(Number((val * 100).toPrecision(12)))
  }
})
</script>
