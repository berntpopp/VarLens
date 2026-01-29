<template>
  <div class="color-swatch-picker">
    <div class="text-caption text-medium-emphasis mb-2">{{ label }}</div>
    <div class="d-flex flex-wrap ga-2">
      <div
        v-for="color in colors"
        :key="color"
        class="color-swatch"
        :class="{ 'color-swatch--selected': modelValue === color }"
        :style="{ backgroundColor: color }"
        role="button"
        tabindex="0"
        :aria-label="`Select color ${color}`"
        :aria-pressed="modelValue === color"
        @click="$emit('update:modelValue', color)"
        @keydown.enter="$emit('update:modelValue', color)"
        @keydown.space.prevent="$emit('update:modelValue', color)"
      >
        <v-icon v-if="modelValue === color" icon="mdi-check" size="small" color="white" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TAG_COLORS } from '../composables/useTags'

defineProps<{
  modelValue: string
  label?: string
}>()

defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

// Use first 12 colors from TAG_COLORS for a compact picker
const colors = TAG_COLORS.slice(0, 12)
</script>

<style scoped>
.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s ease;
  border: 2px solid transparent;
}

.color-swatch:hover {
  transform: scale(1.1);
}

.color-swatch:focus {
  outline: 2px solid rgba(160, 149, 136, 0.5);
  outline-offset: 2px;
}

.color-swatch--selected {
  border-color: rgba(0, 0, 0, 0.3);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.8);
}
</style>
