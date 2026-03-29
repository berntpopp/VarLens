<template>
  <v-overlay
    :model-value="modelValue"
    class="view-transition-overlay"
    persistent
    no-click-animation
    scrim="rgba(250, 248, 246, 0.7)"
  >
    <div class="d-flex flex-column align-center">
      <v-progress-circular indeterminate color="primary" size="40" width="3" />
    </div>
  </v-overlay>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean
}>()
</script>

<style scoped>
.view-transition-overlay {
  z-index: 1000;
}
</style>
