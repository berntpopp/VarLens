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
  <span v-if="readonly" class="points-text">
    {{ modelValue > 0 ? `+${modelValue}` : modelValue }}
  </span>
  <v-text-field
    v-else
    v-model="value"
    type="number"
    :min="min"
    :max="max"
    :step="step"
    :aria-label="label"
    :error-messages="errorMessages"
    :prefix="modelValue > 0 ? '+' : undefined"
    hide-details="auto"
    class="points-input"
    :class="{ 'points-input--negative': modelValue < 0 }"
  />
</template>

<style scoped>
.points-text {
  display: block;
  padding: 6px 13px;
  font-variant-numeric: tabular-nums;
  font-size: 0.8125rem;
}
.points-input--negative :deep(input) {
  color: rgb(var(--v-theme-error));
}
.points-input :deep(input) {
  font-variant-numeric: tabular-nums;
}
/* The sign reads as part of the number: "+3", not "+ 3". */
.points-input.v-text-field--prefixed :deep(.v-field .v-field__input) {
  --v-field-padding-start: 1px;
}
.points-input :deep(.v-text-field__prefix) {
  padding-inline-start: 12px;
  color: inherit;
}
</style>
