<template>
  <!-- An indeterminate bar that overlays the top edge and animates with a
       transform only: unlike v-progress-linear (animated left/right), it
       never counts as a layout shift. -->
  <div class="track-loading">
    <div v-if="active" class="track-loading-bar" role="progressbar" :aria-label="label" />
  </div>
</template>

<script setup lang="ts">
defineProps<{ active: boolean; label: string }>()
</script>

<style scoped>
.track-loading {
  position: relative;
  height: 0;
}

.track-loading-bar {
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  overflow: hidden;
  background: rgba(var(--v-theme-info), 0.2);
}

.track-loading-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgb(var(--v-theme-info));
  transform-origin: left;
  animation: track-loading 1.2s ease-in-out infinite;
}

@keyframes track-loading {
  0% {
    transform: translateX(-100%) scaleX(0.4);
  }

  100% {
    transform: translateX(100%) scaleX(0.4);
  }
}

@media (prefers-reduced-motion: reduce) {
  .track-loading-bar::after {
    animation: none;
    opacity: 0.6;
  }
}
</style>
