<template>
  <!-- Row-menu entry for the protein view (case, cohort and shortlist tables);
       disabled with the reason when it cannot open. -->
  <v-list-item class="px-1" :disabled="reason !== null" @click="open">
    <template #prepend>
      <v-icon size="small" class="mr-1" :icon="PROTEIN_VIEW_BUTTONS[0].icon" />
    </template>
    <v-list-item-title class="text-caption font-weight-medium">Protein view</v-list-item-title>
    <v-list-item-subtitle v-if="reason" class="text-caption">{{ reason }}</v-list-item-subtitle>
  </v-list-item>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import type { Variant } from '../../../../shared/types/api'
import type { CohortVariant } from '../../../../shared/types/cohort'
import { AppStateKey } from '../../composables/useAppState'
import { PROTEIN_VIEW_BUTTONS } from '../../config/proteinViewConfig'
import { useProteinLookupsReason } from '../../composables/useProteinLookupsReason'
import { proteinViewBlockedReason } from '../../utils/protein-view'

const props = defineProps<{ variant: Variant | CohortVariant }>()

const appState = inject(AppStateKey, null)
const lookupsReason = useProteinLookupsReason()
const reason = computed(() => proteinViewBlockedReason(props.variant, lookupsReason.value))

function open(): void {
  if (reason.value === null) appState?.openProteinView(props.variant)
}
</script>
