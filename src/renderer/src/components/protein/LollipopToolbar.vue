<template>
  <v-toolbar density="compact" color="secondary" flat class="lollipop-toolbar">
    <div class="d-flex align-center ga-1 px-2">
      <!-- Zoom controls -->
      <v-tooltip location="bottom">
        <template #activator="{ props: tip }">
          <v-btn v-bind="tip" icon size="small" variant="text" @click="emit('zoom-in')">
            <v-icon size="small" :icon="mdiMagnifyPlusOutline" />
          </v-btn>
        </template>
        Zoom in
      </v-tooltip>

      <v-tooltip location="bottom">
        <template #activator="{ props: tip }">
          <v-btn v-bind="tip" icon size="small" variant="text" @click="emit('zoom-out')">
            <v-icon size="small" :icon="mdiMagnifyMinusOutline" />
          </v-btn>
        </template>
        Zoom out
      </v-tooltip>

      <v-tooltip location="bottom">
        <template #activator="{ props: tip }">
          <v-btn v-bind="tip" icon size="small" variant="text" @click="emit('zoom-reset')">
            <v-icon size="small" :icon="mdiFitToScreenOutline" />
          </v-btn>
        </template>
        Reset zoom
      </v-tooltip>

      <v-divider vertical class="mx-1" />

      <!-- gnomAD toggle -->
      <v-tooltip location="bottom">
        <template #activator="{ props: tip }">
          <v-btn
            v-bind="tip"
            icon
            size="small"
            :variant="showGnomad ? 'flat' : 'text'"
            :color="showGnomad ? 'info' : undefined"
            @click="emit('toggle-gnomad')"
          >
            <v-icon size="small" :icon="mdiEarth" />
          </v-btn>
        </template>
        {{ showGnomad ? 'Hide' : 'Show' }} gnomAD variants
      </v-tooltip>

      <!-- Case variants toggle (only when a case is available) -->
      <v-tooltip v-if="hasCaseId" location="bottom">
        <template #activator="{ props: tip }">
          <v-btn
            v-bind="tip"
            icon
            size="small"
            :variant="showCaseVariants ? 'flat' : 'text'"
            :color="showCaseVariants ? 'success' : undefined"
            :loading="caseVariantsLoading"
            @click="emit('toggle-case-variants')"
          >
            <v-icon size="small" :icon="mdiAccountGroupOutline" />
          </v-btn>
        </template>
        {{ showCaseVariants ? 'Hide' : 'Show' }} case variants
      </v-tooltip>

      <v-divider vertical class="mx-1" />

      <!-- Export buttons -->
      <v-tooltip location="bottom">
        <template #activator="{ props: tip }">
          <v-btn v-bind="tip" icon size="small" variant="text" @click="emit('export-svg')">
            <v-icon size="small" :icon="mdiFileImageOutline" />
          </v-btn>
        </template>
        Export SVG
      </v-tooltip>

      <v-tooltip location="bottom">
        <template #activator="{ props: tip }">
          <v-btn v-bind="tip" icon size="small" variant="text" @click="emit('export-png')">
            <v-icon size="small" :icon="mdiImageOutline" />
          </v-btn>
        </template>
        Export PNG
      </v-tooltip>
    </div>
  </v-toolbar>
</template>

<script setup lang="ts">
import {
  mdiMagnifyPlusOutline,
  mdiMagnifyMinusOutline,
  mdiFitToScreenOutline,
  mdiEarth,
  mdiFileImageOutline,
  mdiImageOutline,
  mdiAccountGroupOutline
} from '@mdi/js'

interface Props {
  showGnomad: boolean
  showCaseVariants: boolean
  caseVariantsLoading: boolean
  hasCaseId: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  'zoom-in': []
  'zoom-out': []
  'zoom-reset': []
  'toggle-gnomad': []
  'toggle-case-variants': []
  'export-svg': []
  'export-png': []
}>()
</script>
