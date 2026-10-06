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
      <IconButton
        label="Case list help"
        tooltip="Ctrl+Click to multi-select cases · Right-click for the context menu"
        :icon="mdiInformationOutline"
        size="small"
        class="mr-1"
      />
      <v-menu location="bottom end" offset="4">
        <template #activator="{ props: menuProps }">
          <IconButton v-bind="menuProps" label="Import data" :icon="mdiPlus" class="mr-1" />
        </template>
        <v-list density="compact">
          <v-list-item
            v-if="multiFileImportAvailable"
            :prepend-icon="mdiFileDocumentMultiple"
            title="Import VCF Files"
            subtitle="Multi-file case (SNV + SV + CNV + STR)"
            @click="$emit('vcf-import-click')"
          />
          <v-list-item
            :prepend-icon="mdiFileImportOutline"
            title="Import Data"
            subtitle="Single file (VCF, JSON, batch)"
            @click="$emit('import-click')"
          />
        </v-list>
      </v-menu>
    </v-toolbar>

    <slot />
  </div>
</template>

<script setup lang="ts">
import {
  mdiInformationOutline,
  mdiPlus,
  mdiFileDocumentMultiple,
  mdiFileImportOutline
} from '@mdi/js'
import { useCapabilityStore } from '../stores/capabilityStore'
import IconButton from './common/IconButton.vue'

const multiFileImportAvailable = useCapabilityStore().canUse('multiFileImport')

defineProps<{
  caseCount?: number
}>()

defineEmits<{
  'import-click': []
  'vcf-import-click': []
}>()
</script>
