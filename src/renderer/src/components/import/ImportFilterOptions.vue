<template>
  <div>
    <!-- Help: explain per-variant-type filter semantics up-front so users
         aren't confused when min QUAL / min GQ silently no-op on SVs. -->
    <v-alert
      type="info"
      variant="tonal"
      density="compact"
      class="mb-3"
      :icon="mdiInformationOutline"
    >
      <div class="text-body-2 mb-1 font-weight-medium">How filters apply per variant type</div>
      <ul class="text-caption ma-0 ps-4">
        <li>
          <strong>PASS-only</strong> &amp; <strong>BED region</strong>: apply to
          <em>all</em> variant types (SNV, indel, SV, CNV, STR).
        </li>
        <li>
          <strong>Min QUAL</strong>: applies to records with a numeric <code>QUAL</code>. SV/CNV/STR
          records typically leave <code>QUAL=.</code> and pass through unchanged — use
          caller-specific metrics in the case view instead.
        </li>
        <li>
          <strong>Min GQ</strong> &amp; <strong>Min DP</strong>: apply to variants that expose
          <code>FORMAT/GQ</code> and <code>FORMAT/DP</code>
          — effectively SNV/indel only. SV/CNV/STR records are NOT filtered by these thresholds.
        </li>
        <li>
          <strong>BED region</strong>: uses <em>interval overlap</em> when the record has an
          <code>END</code> (SV/CNV/STR) and a <em>point check on POS</em> for SNV/indel and
          breakends.
        </li>
      </ul>
    </v-alert>

    <!-- Quality filters -->
    <div class="text-body-2 font-weight-medium mb-2 d-flex align-center ga-2">
      <v-icon :icon="mdiFilterVariant" size="18" />
      Quality filters
    </div>
    <div class="d-flex flex-wrap ga-3 mb-4">
      <v-checkbox
        :model-value="filters.passOnly"
        label="PASS only"
        density="compact"
        hide-details
        @update:model-value="update('passOnly', $event === true)"
      />
      <v-text-field
        :model-value="filters.minQual"
        label="Min QUAL"
        type="number"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        style="max-width: 120px"
        @update:model-value="update('minQual', toNumberOrNull($event))"
      />
      <v-text-field
        :model-value="filters.minGq"
        label="Min GQ"
        type="number"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        style="max-width: 120px"
        @update:model-value="update('minGq', toNumberOrNull($event))"
      />
      <v-text-field
        :model-value="filters.minDp"
        label="Min DP"
        type="number"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        style="max-width: 120px"
        @update:model-value="update('minDp', toNumberOrNull($event))"
      />
    </div>

    <v-divider class="mb-3" />

    <!-- Region filter -->
    <div class="text-body-2 font-weight-medium mb-2 d-flex align-center ga-2">
      <v-icon :icon="mdiMapMarkerRadiusOutline" size="18" />
      Region filter (optional)
    </div>

    <!-- BED file display / browse -->
    <div class="d-flex align-center ga-2 mb-2">
      <v-btn
        size="small"
        variant="outlined"
        :prepend-icon="mdiFolderOpen"
        :loading="browsing"
        @click="browseBed"
      >
        {{
          filters.bedPath !== undefined && filters.bedPath !== ''
            ? 'Change BED file'
            : 'Browse BED file'
        }}
      </v-btn>
      <div
        v-if="filters.bedPath !== undefined && filters.bedPath !== ''"
        class="text-body-2 flex-grow-1 text-truncate"
        :title="filters.bedPath"
      >
        {{ fileName(filters.bedPath) }}
      </div>
      <v-btn
        v-if="filters.bedPath !== undefined && filters.bedPath !== ''"
        icon
        size="x-small"
        variant="text"
        @click="clearBed"
      >
        <v-icon :icon="mdiClose" />
        <v-tooltip activator="parent" location="top">Remove BED filter</v-tooltip>
      </v-btn>
    </div>

    <!-- Sibling BED auto-suggestions (quick-click chips) -->
    <div v-if="availableSuggestions.length > 0" class="mb-2">
      <div class="text-caption text-medium-emphasis mb-1">
        <v-icon :icon="mdiLightbulbOutline" size="14" class="mr-1" />
        Found in the same folder:
      </div>
      <div class="d-flex flex-wrap ga-2">
        <v-chip
          v-for="suggestion in availableSuggestions"
          :key="suggestion"
          size="small"
          variant="outlined"
          color="info"
          :prepend-icon="mdiFileDocumentOutline"
          @click="useSuggestion(suggestion)"
        >
          {{ fileName(suggestion) }}
        </v-chip>
      </div>
    </div>

    <!-- BED padding -->
    <v-text-field
      :model-value="filters.bedPadding"
      label="Region padding (bp)"
      type="number"
      variant="outlined"
      density="compact"
      hide-details
      style="max-width: 200px"
      hint="Bases to add on each side of BED intervals"
      :disabled="filters.bedPath === undefined || filters.bedPath === ''"
      @update:model-value="update('bedPadding', toNumberOrZero($event, 50))"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useApiService } from '../../composables/useApiService'
import { logService } from '../../services/LogService'
import {
  mdiClose,
  mdiFileDocumentOutline,
  mdiFilterVariant,
  mdiFolderOpen,
  mdiInformationOutline,
  mdiLightbulbOutline,
  mdiMapMarkerRadiusOutline
} from '@mdi/js'

export interface ImportFilterState {
  passOnly: boolean
  minQual: number | null
  minGq: number | null
  minDp: number | null
  bedPath?: string
  bedPadding: number
}

const props = defineProps<{
  filters: ImportFilterState
  suggestedBedFiles: string[]
}>()

const emit = defineEmits<{
  'update:filters': [filters: ImportFilterState]
}>()

const { api } = useApiService()
const browsing = ref(false)

const availableSuggestions = computed(() =>
  props.suggestedBedFiles.filter((s) => s !== props.filters.bedPath)
)

function update<K extends keyof ImportFilterState>(key: K, value: ImportFilterState[K]): void {
  emit('update:filters', { ...props.filters, [key]: value })
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toNumberOrZero(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function fileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? normalized : normalized.slice(idx + 1)
}

async function browseBed(): Promise<void> {
  if (api === undefined) return
  browsing.value = true
  try {
    const path = await api.import.selectBedFile()
    if (path !== null && path !== '') {
      update('bedPath', path)
    }
  } catch (err) {
    logService.error(
      `BED file selection failed: ${err instanceof Error ? err.message : String(err)}`,
      'ImportFilterOptions'
    )
  } finally {
    browsing.value = false
  }
}

function clearBed(): void {
  emit('update:filters', { ...props.filters, bedPath: undefined })
}

function useSuggestion(path: string): void {
  update('bedPath', path)
}
</script>
