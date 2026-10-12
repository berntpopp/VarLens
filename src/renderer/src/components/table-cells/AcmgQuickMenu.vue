<template>
  <!-- Single shared quick-classify menu (see acmg-quick-menu.ts). The row
       buttons own the click handling, so the menu never binds its own. -->
  <v-menu
    v-model="open"
    :activator="activator ?? undefined"
    :open-on-click="false"
    :close-on-content-click="true"
    location="bottom"
  >
    <v-card v-if="request" class="pa-2" min-width="200">
      <div class="d-flex flex-wrap ga-1 mb-2">
        <v-chip
          v-for="cls in ACMG_CLASSIFICATIONS"
          :key="cls"
          :color="current === cls ? ACMG_COLORS[cls] : undefined"
          :variant="current === cls ? 'flat' : 'outlined'"
          size="small"
          label
          class="cursor-pointer"
          :disabled="request.locked"
          @click="select(cls)"
        >
          {{ ACMG_ABBREV[cls] }}
        </v-chip>
      </div>
      <div v-if="request.locked" class="text-caption text-medium-emphasis mb-1">
        {{ ACMG_EVIDENCE_LOCK_HINT }}
      </div>
      <v-divider class="mb-1" />
      <v-list density="compact" class="pa-0">
        <v-list-item class="px-1" @click="request.openEvidence()">
          <template #prepend>
            <v-icon size="small" class="mr-1" :icon="mdiClipboardCheckOutline" />
          </template>
          <v-list-item-title class="text-caption font-weight-medium">
            Evidence editor...
          </v-list-item-title>
        </v-list-item>
        <v-list-item
          v-if="request.variant"
          class="px-1"
          :disabled="proteinReason !== null"
          @click="openProteinView"
        >
          <template #prepend>
            <v-icon size="small" class="mr-1" :icon="PROTEIN_VIEW_BUTTONS[0].icon" />
          </template>
          <v-list-item-title class="text-caption font-weight-medium"
            >Protein view</v-list-item-title
          >
          <v-list-item-subtitle v-if="proteinReason" class="text-caption">
            {{ proteinReason }}
          </v-list-item-subtitle>
        </v-list-item>
        <v-list-item v-if="current && !request.locked" class="px-1" @click="select(null)">
          <v-list-item-title class="text-caption text-medium-emphasis">
            Clear classification
          </v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { mdiClipboardCheckOutline } from '@mdi/js'
import {
  ACMG_EVIDENCE_LOCK_HINT,
  type AcmgClassification
} from '../../../../shared/config/domain.config'
import { ACMG_ABBREV, ACMG_CLASSIFICATIONS, ACMG_COLORS } from '../../composables/useAnnotations'
import type { AcmgQuickMenuState } from './acmg-quick-menu'
import { AppStateKey } from '../../composables/useAppState'
import { useCapabilityStore } from '../../stores/capabilityStore'
import { PROTEIN_VIEW_BUTTONS } from '../../config/proteinViewConfig'
import { proteinViewBlockedReason } from '../../utils/protein-view'

const props = defineProps<{ state: AcmgQuickMenuState }>()

// The state object is created once by the table and never replaced.
const { open, activator, payload: request } = props.state
const current = computed(() => request.value?.current ?? null)

const appState = inject(AppStateKey, null)
// Read on demand: the store is only needed once a row with a variant opens the menu.
const proteinReason = computed(() =>
  proteinViewBlockedReason(
    request.value?.variant ?? null,
    useCapabilityStore().canUse('proteinViewer')
  )
)
function openProteinView(): void {
  const variant = request.value?.variant
  if (variant !== undefined && proteinReason.value === null) appState?.openProteinView(variant)
}

function select(classification: AcmgClassification | null): void {
  if (request.value?.locked === true) return
  request.value?.select(classification)
}
</script>
