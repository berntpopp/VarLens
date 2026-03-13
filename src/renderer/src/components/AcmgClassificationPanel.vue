<template>
  <div class="acmg-classification-panel">
    <AcmgSummaryBar
      :effective-classification="effectiveClassification"
      :classification-result="classificationResult"
      :is-override="isOverride"
      :override-classification="overrideClassification"
      :show-auto-suggest="!!variantData"
      :has-active-codes="activeCodes.length > 0"
      @auto-suggest="handleAutoSuggest"
      @override="handleOverride"
    />

    <!-- Pathogenic Criteria Section -->
    <AcmgEvidenceGrid
      title="Pathogenic criteria"
      type="pathogenic"
      :total-points="classificationResult.pathogenicPoints"
      chip-color="error"
      points-prefix="+"
      :groups="pathogenicGroups"
      :all-codes="allEvidenceCodes"
      :is-code-active="isCodeActive"
      :is-code-suggested="isCodeSuggested"
      @code-click="handleCodeClick"
    />

    <!-- Benign Criteria Section -->
    <AcmgEvidenceGrid
      title="Benign criteria"
      type="benign"
      :total-points="classificationResult.benignPoints"
      chip-color="success"
      points-prefix="-"
      :groups="benignGroups"
      :all-codes="allEvidenceCodes"
      :is-code-active="isCodeActive"
      :is-code-suggested="isCodeSuggested"
      @code-click="handleCodeClick"
    />

    <!-- Strength Override for Active Codes -->
    <div v-if="activeCodes.length > 0" class="mb-3">
      <div class="text-caption font-weight-bold mb-1">Active evidence</div>
      <div class="d-flex flex-wrap ga-1">
        <v-chip
          v-for="entry in activeCodes"
          :key="entry.code"
          :color="STRENGTH_COLORS[entry.strength]"
          size="small"
          label
          closable
          @click:close="
            () => {
              toggleCode(entry.code)
              emitChange()
            }
          "
        >
          {{ entry.code }}
          <span class="ml-1 text-caption opacity-70"
            >{{ getStrengthPoints(entry.strength) }}pt</span
          >
          <v-menu location="bottom" :close-on-content-click="true">
            <template #activator="{ props: menuProps }">
              <v-icon v-bind="menuProps" size="x-small" class="ml-1 cursor-pointer" @click.stop
                >mdi-chevron-down</v-icon
              >
            </template>
            <v-list density="compact" nav>
              <v-list-item
                v-for="opt in STRENGTH_OPTIONS"
                :key="opt.value"
                :active="entry.strength === opt.value"
                @click="handleStrengthChange(entry.code, opt.value)"
              >
                <v-list-item-title class="text-caption">
                  {{ opt.label }} ({{ opt.points }} pts)
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
        </v-chip>
      </div>
    </div>

    <!-- Notes -->
    <v-textarea
      v-model="notes"
      placeholder="Evidence notes..."
      variant="outlined"
      density="compact"
      rows="1"
      auto-grow
      hide-details
      class="text-caption"
      @blur="emitChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import type { AcmgClassification } from '../../../main/database/types'
import type { AcmgCode, EvidenceStrength, AcmgEvidenceCode } from '../utils/acmg/types'
import {
  PATHOGENIC_CODES,
  BENIGN_CODES,
  STRENGTH_OPTIONS,
  EVIDENCE_POINTS
} from '../utils/acmg/types'
import type { VariantAnnotationData } from '../utils/acmg/acmg-suggestions'
import { useAcmgEvidence } from '../composables/useAcmgEvidence'
import AcmgSummaryBar from './acmg/AcmgSummaryBar.vue'
import AcmgEvidenceGrid from './acmg/AcmgEvidenceGrid.vue'

const props = defineProps<{
  /** Current acmg_evidence JSON string from database */
  evidenceJson: string | null
  /** Variant annotation data for auto-suggestions */
  variantData: VariantAnnotationData | null
}>()

const emit = defineEmits<{
  /** Emitted when evidence changes. Payload: { classification, evidenceJson } */
  change: [
    payload: {
      classification: AcmgClassification | null
      evidenceJson: string
    }
  ]
}>()

/** Color per strength level for active code chips/buttons */
const STRENGTH_COLORS: Record<EvidenceStrength, string> = {
  very_strong: 'deep-purple',
  strong: 'orange-darken-2',
  moderate: 'amber-darken-1',
  supporting: 'blue-grey',
  stand_alone: 'red-darken-2'
}

const {
  pathogenicCodes,
  benignCodes,
  notes,
  isOverride,
  overrideClassification,
  classificationResult,
  effectiveClassification,
  toggleCode,
  confirmSuggestion,
  setCodeStrength,
  applySuggestions,
  setOverride,
  loadState,
  serialize,
  isCodeActive,
  isCodeSuggested
} = useAcmgEvidence()

/** All confirmed active codes (pathogenic + benign) for the strength adjustment row */
const activeCodes = computed((): AcmgEvidenceCode[] => [
  ...pathogenicCodes.value.filter((c) => c.confirmed),
  ...benignCodes.value.filter((c) => c.confirmed)
])

/** All evidence codes (for passing to grid sub-component for strength lookups) */
const allEvidenceCodes = computed((): AcmgEvidenceCode[] => [
  ...pathogenicCodes.value,
  ...benignCodes.value
])

interface CodeGroup {
  label: string
  points: number
  codes: AcmgCode[]
}

/** Group pathogenic codes by strength category */
const pathogenicGroups = computed((): CodeGroup[] => [
  {
    label: 'Very Strong',
    points: 8,
    codes: PATHOGENIC_CODES.filter((c) => c.startsWith('PVS')) as unknown as AcmgCode[]
  },
  {
    label: 'Strong',
    points: 4,
    codes: PATHOGENIC_CODES.filter((c) => c.startsWith('PS')) as unknown as AcmgCode[]
  },
  {
    label: 'Moderate',
    points: 2,
    codes: PATHOGENIC_CODES.filter((c) => c.startsWith('PM')) as unknown as AcmgCode[]
  },
  {
    label: 'Supporting',
    points: 1,
    codes: PATHOGENIC_CODES.filter((c) => c.startsWith('PP')) as unknown as AcmgCode[]
  }
])

/** Group benign codes by strength category */
const benignGroups = computed((): CodeGroup[] => [
  {
    label: 'Stand-Alone',
    points: 8,
    codes: BENIGN_CODES.filter((c) => c.startsWith('BA')) as unknown as AcmgCode[]
  },
  {
    label: 'Strong',
    points: 4,
    codes: BENIGN_CODES.filter((c) => c.startsWith('BS')) as unknown as AcmgCode[]
  },
  {
    label: 'Supporting',
    points: 1,
    codes: BENIGN_CODES.filter((c) => c.startsWith('BP')) as unknown as AcmgCode[]
  }
])

function getStrengthPoints(strength: EvidenceStrength): number {
  return EVIDENCE_POINTS[strength]
}

function handleCodeClick(code: AcmgCode): void {
  if (isCodeSuggested(code)) {
    confirmSuggestion(code)
  } else {
    toggleCode(code)
  }
  emitChange()
}

function handleStrengthChange(code: AcmgCode, strength: EvidenceStrength): void {
  setCodeStrength(code, strength)
  emitChange()
}

function handleAutoSuggest(): void {
  if (props.variantData) {
    applySuggestions(props.variantData)
    emitChange()
  }
}

function handleOverride(classification: AcmgClassification | null): void {
  if (classification === overrideClassification.value) {
    setOverride(null)
  } else {
    setOverride(classification)
  }
  emitChange()
}

function emitChange(): void {
  emit('change', {
    classification: effectiveClassification.value,
    evidenceJson: serialize()
  })
}

// Load state when evidence JSON or variant identity changes.
// Watching variantData ensures we reset when switching between variants
// that both have null evidence (where evidenceJson alone wouldn't trigger).
watch(
  () => [props.evidenceJson, props.variantData] as const,
  () => loadState(props.evidenceJson),
  { immediate: true }
)
</script>

<style scoped>
.acmg-classification-panel {
  font-size: 13px;
}
</style>
