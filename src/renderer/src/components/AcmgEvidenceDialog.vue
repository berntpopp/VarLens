<template>
  <v-dialog :model-value="dialogOpen" max-width="480" scrollable @update:model-value="requestClose">
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
          @click="requestClose"
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
        <div v-if="!canWrite" class="text-body-small text-medium-emphasis mb-2" role="note">
          {{ writeBlockedReason }}
        </div>
        <AcmgClassificationPanel
          ref="panelRef"
          :evidence-json="evidenceJson"
          :variant-data="variantData"
          :save="handleSave"
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
import { usePermissions } from '../composables/usePermissions'

const props = defineProps<{
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
  /** Persists the applied evidence; resolves false when nothing was saved. */
  save: (payload: {
    classification: AcmgClassification | null
    evidenceJson: string
  }) => Promise<boolean>
}>()

const dialogOpen = ref(false)

function open(): void {
  dialogOpen.value = true
}

const panelRef = ref<{ confirmLeave: () => Promise<boolean> | null } | null>(null)

/** Close button, Escape and click outside: an unsaved draft is asked about first. */
async function requestClose(): Promise<void> {
  if ((await panelRef.value?.confirmLeave()) !== false) dialogOpen.value = false
}

const { canWrite, writeBlockedReason } = usePermissions()

async function handleSave(payload: {
  classification: AcmgClassification | null
  evidenceJson: string
}): Promise<boolean> {
  return canWrite.value && (await props.save(payload))
}

defineExpose({ open })
</script>

<style scoped>
.mt-half {
  margin-top: 2px;
}
</style>
