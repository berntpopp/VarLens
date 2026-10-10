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
        <template v-for="entry in activeCodes" :key="entry.code">
          <v-chip
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
            <span class="ml-1 text-caption opacity-70">
              {{ getStrengthPoints(entry.strength) }}pt
            </span>
            <v-menu location="bottom" :close-on-content-click="true">
              <template #activator="{ props: menuProps }">
                <button
                  v-bind="menuProps"
                  type="button"
                  class="inline-icon-btn ml-1"
                  :aria-label="`Change ${entry.code} strength`"
                  @click.stop
                >
                  <v-icon size="x-small" :icon="mdiChevronDown" />
                </button>
              </template>
              <v-list density="compact" nav>
                <v-list-item
                  v-for="opt in strengthOptionsFor(entry.code)"
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
          <v-chip
            v-if="entry.code === 'PM2'"
            size="x-small"
            variant="tonal"
            :color="entry.strength === 'supporting' ? 'info' : 'warning'"
            class="ml-1 text-caption cursor-pointer"
            @click="
              handleStrengthChange(
                entry.code,
                entry.strength === 'supporting' ? 'moderate' : 'supporting'
              )
            "
          >
            ClinGen SVI:
            {{ entry.strength === 'supporting' ? 'Supporting (1pt)' : 'Moderate (2pt)' }}
            <v-tooltip activator="parent" location="top">
              ClinGen SVI 2020 recommends PM2 at Supporting (1pt) for rarity. Click to toggle
              between Supporting and Moderate.
            </v-tooltip>
          </v-chip>
        </template>
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

    <!-- Confirm step: evidence edits stay a draft until applied -->
    <div
      v-if="pending !== null"
      class="acmg-apply-bar d-flex align-center flex-wrap ga-2 mt-3 pa-2"
      role="region"
      aria-label="Unsaved ACMG changes"
      data-testid="acmg-apply-bar"
    >
      <span class="text-body-small flex-grow-1">
        <strong>Unsaved:</strong> {{ pendingSummary }}
      </span>
      <v-btn size="small" variant="text" data-testid="acmg-discard" @click="discardPending">
        Discard
      </v-btn>
      <v-btn
        size="small"
        color="primary"
        variant="flat"
        data-testid="acmg-apply"
        @click="applyPending"
      >
        Apply classification
      </v-btn>
    </div>

    <!-- Asked before the selection moves off a variant with an unsaved draft -->
    <v-dialog
      :model-value="leavePrompt"
      max-width="420"
      persistent
      aria-labelledby="acmg-leave-title"
      @keydown="onLeaveKeydown"
    >
      <v-card data-testid="acmg-leave-prompt">
        <v-card-title id="acmg-leave-title">Unsaved ACMG changes</v-card-title>
        <v-card-text>
          {{ pendingSummary }} has not been applied. Apply it before leaving this variant?
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn data-testid="acmg-leave-cancel" @click="answerLeave('cancel')">Cancel</v-btn>
          <v-btn data-testid="acmg-leave-discard" @click="answerLeave('discard')">Discard</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            data-testid="acmg-leave-apply"
            @click="answerLeave('apply')"
          >
            Apply
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { AppStateKey } from '../composables/useAppState'
import {
  evidenceFingerprint,
  hasMeaningfulAcmgEvidence,
  summarizeAcmgDraft
} from '../utils/acmg/acmg-undo'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import type { AcmgCode, EvidenceStrength, AcmgEvidenceCode } from '../utils/acmg/types'
import {
  PATHOGENIC_CODES,
  BENIGN_CODES,
  strengthOptionsFor,
  EVIDENCE_POINTS
} from '../utils/acmg/types'
import type { VariantAnnotationData } from '../utils/acmg/acmg-suggestions'
import { useAcmgEvidence } from '../composables/useAcmgEvidence'
import AcmgSummaryBar from './acmg/AcmgSummaryBar.vue'
import AcmgEvidenceGrid from './acmg/AcmgEvidenceGrid.vue'
import { mdiChevronDown } from '@mdi/js'

const appState = inject(AppStateKey, null)

interface AcmgDraft {
  classification: AcmgClassification | null
  evidenceJson: string
}

const props = defineProps<{
  /** Current acmg_evidence JSON string from database */
  evidenceJson: string | null
  /** Variant annotation data for auto-suggestions */
  variantData: VariantAnnotationData | null
  /** Persists an applied draft; the draft stays pending unless it resolves true. */
  save?: (draft: AcmgDraft) => Promise<boolean>
}>()

const emit = defineEmits<{
  /** Emitted when evidence changes. Payload: { classification, evidenceJson } */
  change: [payload: AcmgDraft]
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

/**
 * Confirm step: criterion clicks, strength changes, overrides and notes build
 * a draft; nothing is written (and no classification changes in the table)
 * until "Apply classification". Applying is then undoable via the snackbar.
 */
const pending = ref<AcmgDraft | null>(null)

/** Serialized saved state; a draft equal to it is not pending. */
let baselineJson = ''

const pendingSummary = computed(() =>
  summarizeAcmgDraft({
    classification: effectiveClassification.value,
    netPoints: classificationResult.value.netPoints,
    codes: activeCodes.value.map((c) => c.code)
  })
)

function emitChange(): void {
  const evidenceJson = serialize()
  pending.value =
    evidenceFingerprint(evidenceJson) === baselineJson
      ? null
      : { classification: effectiveClassification.value, evidenceJson }
}

async function applyPending(): Promise<void> {
  const draft = pending.value
  if (draft === null) return
  if (props.save) {
    const variantData = props.variantData
    const saved = await props.save(draft)
    await nextTick()
    // Another variant was opened while saving: its state is already loaded.
    if (props.variantData !== variantData) return
    if (!saved) {
      // The failed write's rollback reloaded the saved evidence: put the draft back.
      loadState(draft.evidenceJson)
      pending.value = draft
      appState?.showSnack('Failed to save ACMG classification', 'error')
      return
    }
  } else {
    emit('change', draft)
  }
  baselineJson = evidenceFingerprint(draft.evidenceJson)
  pending.value = null
}

function discardPending(): void {
  pending.value = null
  loadState(props.evidenceJson)
  baselineJson = evidenceFingerprint(serialize())
}

const leavePrompt = ref(false)
let resolveLeave: ((leave: boolean) => void) | null = null

/** Null when nothing is unsaved; otherwise asks, and resolves true once it is safe to leave. */
function confirmLeave(): Promise<boolean> | null {
  emitChange() // notes typed but not blurred yet
  if (pending.value === null) return null
  // Unconfirmed suggestions alone are not work to lose.
  if (
    !hasMeaningfulAcmgEvidence(pending.value.evidenceJson) &&
    !hasMeaningfulAcmgEvidence(props.evidenceJson)
  )
    return null
  leavePrompt.value = true
  return new Promise((resolve) => (resolveLeave = resolve))
}

/** The draft is gone (state reloaded, panel removed): nothing left to ask about. */
function settleLeave(leave: boolean): void {
  leavePrompt.value = false
  resolveLeave?.(leave)
  resolveLeave = null
}

async function answerLeave(answer: 'apply' | 'discard' | 'cancel'): Promise<void> {
  const resolve = resolveLeave
  if (resolve === null) return // already answered (double click)
  // Taken before the save: its evidence reload must not settle the prompt early.
  resolveLeave = null
  leavePrompt.value = false
  try {
    if (answer === 'apply') await applyPending()
    else if (answer === 'discard') discardPending()
  } catch {
    appState?.showSnack('Failed to save ACMG classification', 'error')
  } finally {
    // Also after a rejected save: the held selection change must not wait forever.
    resolve(pending.value === null)
  }
}

function onLeaveKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  // Escape answers the prompt only; the panel and the tables also listen for it on window.
  e.stopPropagation()
  void answerLeave('cancel')
}

// Load state when evidence JSON or variant identity changes.
// Watching variantData ensures we reset when switching between variants
// that both have null evidence (where evidenceJson alone wouldn't trigger).
watch(
  () => [props.evidenceJson, props.variantData] as const,
  (_, old) => {
    // Same variant (late annotation load, a save's own reload): the draft and its prompt stay.
    const draft = old?.[1] === props.variantData ? pending.value : null
    loadState(props.evidenceJson)
    baselineJson = evidenceFingerprint(serialize())
    if (draft !== null) return loadState(draft.evidenceJson)
    pending.value = null
    settleLeave(true)
  },
  { immediate: true }
)

onBeforeUnmount(() => settleLeave(true))

defineExpose({ applyPending, discardPending, pending, confirmLeave })
</script>

<style scoped>
.acmg-classification-panel {
  font-size: 0.8125rem;
}

.acmg-apply-bar {
  border: 1px solid rgb(var(--v-theme-primary));
  border-radius: 4px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, rgb(var(--v-theme-surface)));
}
</style>
