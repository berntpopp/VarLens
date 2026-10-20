<template>
  <!-- One chip per released ClinGen VCEP specification of the gene (#201). -->
  <v-chip
    v-for="spec in specs"
    :key="spec.id"
    data-testid="clingen-spec"
    size="x-small"
    label
    variant="tonal"
    color="primary"
    class="text-none"
    :data-tooltip="CLINGEN_SPEC_COPY.tooltip(spec.panel, spec.version, CSPEC.retrieved)"
    data-tooltip-location="top"
    @click="open(spec.url)"
  >
    {{ CLINGEN_SPEC_COPY.chip(spec.id, specs.length > 1) }}
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
// Refresh: node scripts/clingen/refresh-cspec-snapshot.mjs
import CSPEC from '../assets/data/clingen-cspec.json'
import { CLINGEN_SPEC_COPY } from '../config/uiCopyConfig'
import { useApiService } from '../composables/useApiService'
import { logService } from '../services/LogService'
import { formatError } from '../utils/ipc-result'
import { unwrapIpcResult } from '../../../shared/types/errors'

interface ClinGenSpec {
  id: string
  version: string | null
  panel: string | null
  url: string
}

const props = defineProps<{ gene: string | null }>()

const GENES: Readonly<Record<string, readonly ClinGenSpec[]>> = CSPEC.genes
const specs = computed(() => (props.gene === null ? [] : (GENES[props.gene] ?? [])))

const { api } = useApiService()

async function open(url: string): Promise<void> {
  if (!api) return
  try {
    const result = unwrapIpcResult(await api.shell.openExternal(url))
    if (!result.success) {
      logService.warn(`Could not open ${url}`, 'clingen-spec')
    }
  } catch (e) {
    logService.warn('Failed to open ClinGen specification: ' + formatError(e), 'clingen-spec')
  }
}
</script>
