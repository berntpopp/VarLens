<template>
  <div class="app-sidebar">
    <v-toolbar density="compact" color="app-bar" class="app-sidebar__toolbar">
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
      <!-- Import is an analyst action; viewers do not get the menu at all. -->
      <v-menu v-if="canWrite" location="bottom end" offset="4">
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
            subtitle="One or many files (VCF, JSON, folder, ZIP)"
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
import { usePermissions } from '../composables/usePermissions'
import { useCapabilityStore } from '../stores/capabilityStore'
import IconButton from './common/IconButton.vue'

const { canWrite } = usePermissions()

const multiFileImportAvailable = useCapabilityStore().canUse('multiFileImport')

defineProps<{
  caseCount?: number
}>()

defineEmits<{
  'import-click': []
  'vcf-import-click': []
}>()
</script>

<style scoped>
/* The toolbar and the case list's search/filters stay visible while the list scrolls. */
.app-sidebar {
  --sidebar-toolbar-height: 48px;
}

.app-sidebar__toolbar {
  position: sticky;
  top: 0;
  z-index: 3;
}

.app-sidebar :deep(.case-list-controls) {
  position: sticky;
  top: var(--sidebar-toolbar-height);
  z-index: 2;
  background: rgb(var(--v-theme-surface));
}
</style>
