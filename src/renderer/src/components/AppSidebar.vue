<template>
  <div>
    <v-toolbar density="compact" color="primary" dark>
      <span class="ml-2 text-body-large font-weight-medium">
        Cases
        <span v-if="(caseCount ?? 0) > 0" class="text-body-small ml-1" style="opacity: 0.8"
          >({{ caseCount }})</span
        >
      </span>
      <v-spacer />
      <v-tooltip location="bottom">
        <template #activator="{ props: tipProps }">
          <v-btn icon size="x-small" variant="text" v-bind="tipProps">
            <v-icon size="x-small" :icon="mdiInformationOutline" />
          </v-btn>
        </template>
        <div class="text-body-small">
          <div>Ctrl+Click to multi-select cases</div>
          <div>Right-click for context menu</div>
        </div>
      </v-tooltip>
      <v-btn icon size="small" variant="text" @click="$emit('import-click')">
        <v-icon :icon="mdiPlus" />
        <v-tooltip activator="parent" location="bottom">Import data (Ctrl+I)</v-tooltip>
      </v-btn>
    </v-toolbar>

    <slot />
  </div>
</template>

<script setup lang="ts">
import { mdiInformationOutline, mdiPlus } from '@mdi/js'
defineProps<{
  caseCount?: number
}>()

defineEmits<{
  'import-click': []
}>()
</script>
