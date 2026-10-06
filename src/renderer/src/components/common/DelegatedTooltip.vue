<template>
  <v-tooltip
    v-if="target"
    :model-value="open"
    :target="target"
    :location="location"
    :open-on-hover="false"
    :open-on-focus="false"
    :open-on-click="false"
    content-class="bg-secondary"
    data-testid="delegated-tooltip"
  >
    {{ text }}
  </v-tooltip>
</template>

<script setup lang="ts">
/** The single app-wide tooltip for elements that declare `data-tooltip`. */
import { useDelegatedTooltip } from '../../composables/useDelegatedTooltip'

const { open, text, location, target } = useDelegatedTooltip()
</script>
