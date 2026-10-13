<template>
  <v-chip
    v-if="importStore.isActive"
    size="small"
    color="white"
    variant="outlined"
    class="mx-1 import-chip"
    @click="$emit('click')"
  >
    <v-progress-circular
      :indeterminate="importStore.phase === 'finalizing'"
      :model-value="importStore.overallPercent"
      size="16"
      width="2"
      class="mr-1"
      :aria-label="IMPORT_A11Y_COPY.statusProgress"
    />
    <span class="text-caption">
      {{ importStore.fileProgress }}
      ({{ importStore.overallPercent }}%)
    </span>
    <v-tooltip activator="parent" location="bottom">
      {{
        importStore.phase === 'finalizing'
          ? 'Finalizing import...'
          : `Importing ${importStore.currentFileName}`
      }}
    </v-tooltip>
  </v-chip>
</template>

<script setup lang="ts">
import { useImportStatusStore } from '../stores/importStatusStore'
import { IMPORT_A11Y_COPY } from '../config/importConfig'

const importStore = useImportStatusStore()

defineEmits<{
  click: []
}>()
</script>

<style scoped>
.import-chip {
  cursor: pointer;
}
</style>
