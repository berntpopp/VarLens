<script setup lang="ts">
/** Signed points stepper on the configured scale (half steps, ±limit). */
import { computed } from 'vue'
import { SHORTLIST_EVIDENCE_CONFIG } from '../../../../shared/config/shortlist-evidence.config'

const props = defineProps<{
  modelValue: number
  label: string
  errorMessages?: string[]
  readonly?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const { min, max, step } = SHORTLIST_EVIDENCE_CONFIG.points

const value = computed({
  get: () => props.modelValue,
  // An empty field is NaN; the schema then reports it at the field.
  set: (v: string | number) => emit('update:modelValue', Number(v === '' ? NaN : v))
})
</script>

<template>
  <code v-if="readonly" class="points-text" :aria-label="label">
    {{ modelValue > 0 ? `+${modelValue}` : modelValue }}
  </code>
  <v-text-field
    v-else
    v-model="value"
    type="number"
    :min="min"
    :max="max"
    :step="step"
    :aria-label="label"
    :error-messages="errorMessages"
    hide-details="auto"
    class="points-input"
  />
</template>

<style scoped>
.points-text {
  display: block;
  padding: 6px 4px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
  background: none;
}
.points-input :deep(input) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
