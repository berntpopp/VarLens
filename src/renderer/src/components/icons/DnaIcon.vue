<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    :stroke="color || 'currentColor'"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <!-- Left helix strand - flowing S-curve -->
    <path d="M6 3 Q6 6 8 9 T6 15 Q6 18 6 21" />

    <!-- Right helix strand - mirror S-curve -->
    <path d="M18 3 Q18 6 16 9 T18 15 Q18 18 18 21" />

    <!-- Base pair rungs connecting the strands -->
    <line x1="6" y1="5" x2="18" y2="5" stroke-width="1.5" />
    <line x1="7" y1="7.5" x2="17" y2="7.5" stroke-width="1.5" />
    <line x1="8" y1="10" x2="16" y2="10" stroke-width="1.5" />
    <line x1="7" y1="12.5" x2="17" y2="12.5" stroke-width="1.5" />
    <line x1="6" y1="15" x2="18" y2="15" stroke-width="1.5" />
    <line x1="7" y1="17.5" x2="17" y2="17.5" stroke-width="1.5" />
    <line x1="6" y1="20" x2="18" y2="20" stroke-width="1.5" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  size?: string | number
  color?: string
}>(), {
  size: 24
})
</script>
