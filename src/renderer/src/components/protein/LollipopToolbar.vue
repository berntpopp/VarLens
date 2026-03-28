<template>
  <v-toolbar density="compact" color="secondary" flat class="lollipop-toolbar">
    <div class="d-flex align-center ga-1 px-2 flex-wrap">
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
            size="small"
            :variant="showGnomad ? 'flat' : 'text'"
            :color="showGnomad ? 'primary' : undefined"
            :prepend-icon="mdiEarth"
            class="text-none"
            @click="emit('toggle-gnomad')"
          >
            gnomAD
          </v-btn>
        </template>
        {{ showGnomad ? 'Hide' : 'Show' }} gnomAD variants
      </v-tooltip>

      <!-- gnomAD frequency filter (only shown when gnomAD is visible) -->
      <template v-if="showGnomad">
        <v-menu :close-on-content-click="false" location="bottom" offset="4">
          <template #activator="{ props: menuProps }">
            <v-chip
              v-bind="menuProps"
              size="small"
              label
              variant="outlined"
              class="ml-1 cursor-pointer"
              :prepend-icon="mdiFilterVariant"
            >
              AF &le; {{ formatAf(gnomadMaxAf) }}
              <span v-if="gnomadTotal > 0" class="ml-1 text-medium-emphasis">
                ({{ gnomadCount }}/{{ gnomadTotal }})
              </span>
            </v-chip>
          </template>
          <v-card min-width="240" class="pa-3">
            <div class="text-body-2 font-weight-medium mb-2">gnomAD Allele Frequency Filter</div>
            <v-chip-group
              :model-value="gnomadMaxAf"
              mandatory
              column
              @update:model-value="emit('update:gnomad-max-af', $event)"
            >
              <v-chip
                v-for="preset in afPresets"
                :key="preset.value"
                :value="preset.value"
                size="small"
                label
                variant="outlined"
                class="mr-1 mb-1"
              >
                {{ preset.label }}
              </v-chip>
            </v-chip-group>
          </v-card>
        </v-menu>
      </template>

      <!-- Case variants toggle (only when a case is available) -->
      <v-tooltip v-if="hasCaseId" location="bottom">
        <template #activator="{ props: tip }">
          <v-btn
            v-bind="tip"
            size="small"
            :variant="showCaseVariants ? 'flat' : 'text'"
            :color="showCaseVariants ? 'success' : undefined"
            :loading="caseVariantsLoading"
            :prepend-icon="mdiAccountGroupOutline"
            class="text-none"
            @click="emit('toggle-case-variants')"
          >
            Case
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
  mdiAccountGroupOutline,
  mdiFilterVariant
} from '@mdi/js'

interface Props {
  showGnomad: boolean
  showCaseVariants: boolean
  caseVariantsLoading: boolean
  hasCaseId: boolean
  /** Current gnomAD max AF filter value */
  gnomadMaxAf: number
  /** Number of gnomAD variants passing the current filter */
  gnomadCount: number
  /** Total number of gnomAD variants */
  gnomadTotal: number
}

defineProps<Props>()

const emit = defineEmits<{
  'zoom-in': []
  'zoom-out': []
  'zoom-reset': []
  'toggle-gnomad': []
  'toggle-case-variants': []
  'update:gnomad-max-af': [value: number]
  'export-svg': []
  'export-png': []
}>()

/** AF filter presets */
const afPresets = [
  { label: 'All', value: 1 },
  { label: 'AF < 1%', value: 0.01 },
  { label: 'AF < 0.1%', value: 0.001 },
  { label: 'AF < 0.01%', value: 0.0001 },
  { label: 'AF < 0.001%', value: 0.00001 }
]

function formatAf(af: number): string {
  if (af >= 1) return 'All'
  if (af >= 0.01) return `${(af * 100).toFixed(0)}%`
  return af.toExponential(0)
}
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
