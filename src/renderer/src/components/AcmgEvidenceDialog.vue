<template>
  <v-dialog v-model="dialogOpen" max-width="480" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between pa-3">
        <div class="d-flex align-center ga-2">
          <v-icon size="small" color="primary" :icon="mdiClipboardCheckOutline" />
          <span class="text-body-2 font-weight-bold">ACMG Evidence Classification</span>
        </div>
        <v-btn
          aria-label="Close"
          :icon="mdiClose"
          size="x-small"
          variant="text"
          @click="dialogOpen = false"
        />
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-3">
        <div v-if="variantLabel" class="text-caption text-medium-emphasis mb-2">
          {{ variantLabel }}
          <span v-if="variantCdna || variantAaChange" class="d-block mt-half">
            <span v-if="variantCdna">{{ variantCdna }}</span>
            <span v-if="variantCdna && variantAaChange"> · </span>
            <span v-if="variantAaChange">{{ variantAaChange }}</span>
          </span>
        </div>
        <AcmgClassificationPanel
          :evidence-json="evidenceJson"
          :variant-data="variantData"
          @change="handleChange"
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import type { VariantAnnotationData } from '../utils/acmg/acmg-suggestions'
import AcmgClassificationPanel from './AcmgClassificationPanel.vue'
import { mdiClipboardCheckOutline, mdiClose } from '@mdi/js'

defineProps<{
  /** Evidence JSON from database */
  evidenceJson: string | null
  /** Variant annotation data for auto-suggestions */
  variantData: VariantAnnotationData | null
  /** Label showing which variant this is for */
  variantLabel?: string
  /** cDNA change notation (e.g., c.1518401A>G) */
  variantCdna?: string | null
  /** Amino acid change notation (e.g., p.Met41Val) */
  variantAaChange?: string | null
}>()

const emit = defineEmits<{
  change: [
    payload: {
      classification: AcmgClassification | null
      evidenceJson: string
    }
  ]
}>()

const dialogOpen = ref(false)

function open(): void {
  dialogOpen.value = true
}

function handleChange(payload: {
  classification: AcmgClassification | null
  evidenceJson: string
}): void {
  emit('change', payload)
}

defineExpose({ open })
</script>

<style scoped>
.mt-half {
  margin-top: 2px;
}
</style>
