<template>
  <!-- order=1: laid out after the app footer, so the footer spans beneath the
       panel and docking never moves the footer controls (layout shift). -->
  <v-navigation-drawer
    :model-value="open"
    tag="aside"
    aria-label="Variant details"
    location="right"
    :order="1"
    :temporary="!detailPanelDocked"
    :persistent="true"
    :scrim="false"
    :width="effectiveWidth"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="resize-handle" @mousedown="startResize" />

    <v-card flat class="h-100 d-flex flex-column">
      <v-toolbar color="transparent" density="compact" flat>
        <v-toolbar-title class="text-body-large">
          <h2 ref="headingRef" tabindex="-1" class="panel-heading text-truncate">{{ heading }}</h2>
        </v-toolbar-title>
        <IconButton
          label="Close variant details"
          :icon="mdiClose"
          @click="emit('update:open', false)"
        />
      </v-toolbar>

      <v-divider />

      <div
        ref="scrollRef"
        data-testid="variant-details-scroll"
        class="flex-grow-1 overflow-y-auto pa-3"
      >
        <v-skeleton-loader
          v-if="variant && isLoading"
          type="card-heading, list-item-three-line@4"
          class="variant-details-skeleton"
        />

        <template v-else-if="variant">
          <VariantIdentitySection
            :variant="variant"
            :colocated-variants="colocatedVariants"
            :genome-build="genomeBuild"
            class="mb-2"
            @open-protein-view="openProteinView"
          />
          <ProteinPreviewStrip :variant="variant" class="mb-4" @open="openProteinView" />

          <!-- SV/CNV/STR details; a cohort row has no per-call fields, so it shows the call context only -->
          <ExtensionDetailsSection
            :variant="variant as unknown as Record<string, unknown>"
            :genome-build="genomeBuild"
            :summary-only="mode === 'cohort'"
          />

          <TranscriptSection
            :variant-id="mode === 'case' && 'id' in variant ? (variant as Variant).id : null"
            :vep-transcripts="allTranscripts"
            :vep-loading="vepLoading"
            :mode="mode"
            :variant-chr="variant.chr"
            :variant-pos="variant.pos"
            :variant-ref="variant.ref"
            :variant-alt="variant.alt"
            :fetch-vep="vepFetchAvailable ? fetchVep : undefined"
            :fetch-vep-unavailable-reason="capabilities.capabilityReason('vepEnrichment')"
            class="mb-4"
            @transcript-switched="emit('variant-updated')"
          />

          <v-divider class="mb-4" />

          <AnnotationScoresSection
            :variant="variant"
            :preferred-transcript="preferredTranscript"
            :vep-loading="vepLoading"
            :is-offline="isOffline"
            :revel-score="revelScore"
            :alphamissense-score="alphamissenseScore"
            :spliceai-max-delta="spliceaiMaxDelta"
            :is-loading="isLoading"
            class="mb-4"
          />

          <InfoFieldsSection
            v-if="mode === 'case'"
            :info-json="(variant as Variant).info_json"
            :case-id="caseId"
          />

          <!-- VEP metadata (consequence + cache indicator) -->
          <div v-if="mostSevereConsequence" class="text-body-small mb-2">
            <v-chip size="x-small" :color="consequenceChipColor(mostSevereConsequence)" label>
              {{ formatConsequence(mostSevereConsequence) }}
            </v-chip>
          </div>

          <div v-if="isCached && cachedAt" class="text-body-small text-muted mb-2">
            Cached from {{ cachedAt.toLocaleDateString() }}
          </div>

          <v-divider class="mb-4" />

          <!-- Section 3: ACMG Classification -->
          <div class="acmg-section mb-4">
            <div class="d-flex align-center flex-wrap ga-1 mb-2">
              <h3 class="text-title-small">ACMG Classification</h3>
              <ClinGenSpecChips :gene="variant.gene_symbol ?? null" />
            </div>

            <div class="d-flex flex-wrap ga-1 mb-2">
              <v-chip
                v-for="cls in ACMG_CLASSIFICATIONS"
                :key="cls"
                role="button"
                :aria-pressed="currentQuickClassification === cls"
                :aria-label="cls"
                :color="currentQuickClassification === cls ? ACMG_COLORS[cls] : undefined"
                :variant="currentQuickClassification === cls ? 'flat' : 'outlined'"
                size="small"
                label
                class="cursor-pointer"
                :disabled="!canWrite || acmgLocked"
                @click="handleQuickClassify(cls)"
              >
                {{ ACMG_ABBREV[cls] }}
              </v-chip>
              <v-chip
                v-if="currentQuickClassification && canWrite && !acmgLocked"
                variant="text"
                size="small"
                class="cursor-pointer text-medium-emphasis"
                aria-label="Clear classification"
                @click="handleQuickClassify(null)"
              >
                <v-icon size="x-small" :icon="mdiClose" />
              </v-chip>
            </div>
            <div v-if="acmgLocked && canWrite" class="text-caption text-medium-emphasis mb-1">
              {{ ACMG_EVIDENCE_LOCK_HINT }}
            </div>

            <!-- Evidence-based classification panel -->
            <div v-if="canWrite" class="mb-1">
              <div
                v-if="suggestedAcmgCodes.length > 0"
                class="d-flex align-center justify-end mb-1"
              >
                <v-btn
                  size="x-small"
                  variant="text"
                  color="primary"
                  density="compact"
                  class="text-caption px-1"
                  data-testid="apply-acmg-suggestions-btn"
                  @click="handleApplySuggestionsPreview"
                >
                  Apply suggestions ({{ suggestedAcmgCodes.join(', ') }})
                </v-btn>
              </div>
              <v-expansion-panels v-model="acmgExpanded" variant="accordion">
                <v-expansion-panel :value="0">
                  <v-expansion-panel-title class="text-body-2 pa-2">
                    <v-icon size="small" class="mr-1" :icon="mdiClipboardCheckOutline" />
                    Evidence editor
                    <span v-if="hasAcmgEvidence" class="text-caption text-medium-emphasis ml-1">
                      (has evidence)
                    </span>
                    <!-- Inline suggestion preview pills (read-only chips) (#685, #669) -->
                    <div
                      v-if="suggestedAcmgCodes.length > 0"
                      class="d-inline-flex align-center ga-1 ml-2"
                      data-testid="acmg-suggested-preview"
                    >
                      <v-chip
                        v-for="code in suggestedAcmgCodes"
                        :key="code"
                        size="x-small"
                        color="warning"
                        variant="tonal"
                        class="text-caption font-weight-bold"
                      >
                        {{ code }}
                      </v-chip>
                    </div>
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <AcmgClassificationPanel
                      ref="acmgPanelRef"
                      :variant-key="variantKey"
                      :evidence-json="currentAcmgEvidence"
                      :variant-data="currentVariantData"
                      :save="handleAcmgEvidenceChange"
                    />
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>
            </div>

            <div v-if="hasGlobalAcmg && mode === 'case'" class="text-body-small text-muted mt-1">
              Global: {{ globalAcmgClassification }}
            </div>
          </div>

          <v-divider class="mb-4" />

          <!-- Section 4: Tags (case mode only) -->
          <template v-if="mode === 'case' && caseId !== null && 'id' in variant">
            <TagsSection
              :case-id="caseId"
              :variant-id="(variant as Variant).id"
              class="mb-4"
              @changed="handleTagsChanged"
            />
            <v-divider class="mb-4" />
          </template>

          <!-- Section 5: Comments -->
          <CommentsSection :variant="variant" :case-id="caseId" :mode="mode" class="mb-4" />

          <v-divider class="mb-4" />

          <!-- Section 6: Activity Log -->
          <v-expansion-panels variant="accordion" class="mb-4">
            <v-expansion-panel>
              <v-expansion-panel-title class="text-body-2">
                <v-icon size="small" class="mr-1" :icon="mdiHistory" />
                Activity Log
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <ActivityLogPanel :entity-keys="auditEntityKeys" />
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>

          <v-divider class="mb-4" />

          <!-- Section 7: External Links -->
          <ExternalLinksSection :variant="variant" :genome-build="genomeBuild" />
        </template>

        <div v-else class="text-muted text-center mt-4">Select a variant to view details</div>
      </div>
    </v-card>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import {
  ref,
  onMounted,
  onUnmounted,
  computed,
  watch,
  defineAsyncComponent,
  inject,
  provide,
  type AsyncComponentLoader
} from 'vue'
import { useVariantAcmgPreview } from '../utils/acmg/acmg-variant-data'
import { AppStateKey } from '../composables/useAppState'
import { usePanelResize } from '../composables/usePanelResize'
import { useResponsiveLayout } from '../composables/useResponsiveLayout'
import { clampDetailPanelWidth } from '../utils/responsive-layout'
import { formatConsequence, variantHeading } from '../utils/formatters'
import { AnnotationBuildKey, useAnnotations } from '../composables/useAnnotations'
import { globalAnnotationEntityKey } from '../../../shared/audit/annotation-entity-key'
import { useAcmgUndo } from '../composables/useAcmgUndo'
import { hasDecidingAcmgEvidence, hasMeaningfulAcmgEvidence } from '../utils/acmg/acmg-undo'
import { useVepEnrichment } from '../composables/useVepEnrichment'
import VariantIdentitySection from './VariantIdentitySection.vue'
import { consequenceChipColor } from '../config/displayConfig'
import ClinGenSpecChips from './ClinGenSpecChips.vue'
import ProteinPreviewStrip from './protein/ProteinPreviewStrip.vue'
import type { ProteinViewTab } from '../config/proteinViewConfig'
import IconButton from './common/IconButton.vue'
import { usePanelFocus } from '../composables/usePanelFocus'
import { isOverlayOpen, isTextEntryFocused } from '../composables/useTableKeyboardNav'
import AnnotationScoresSection from './AnnotationScoresSection.vue'
import TranscriptSection from './TranscriptSection.vue'
import ExtensionDetailsSection from './variant-details/ExtensionDetailsSection.vue'
import InfoFieldsSection from './variant-details/InfoFieldsSection.vue'

// Lazy-load non-critical panel sections to speed up initial open
import SectionSkeleton from './SectionSkeleton.vue'

const lazySection = (loader: AsyncComponentLoader) =>
  defineAsyncComponent({ loader, delay: 0, loadingComponent: SectionSkeleton })
const ExternalLinksSection = lazySection(() => import('./ExternalLinksSection.vue'))
const CommentsSection = lazySection(() => import('./CommentsSection.vue'))
const TagsSection = lazySection(() => import('./TagsSection.vue'))
const AcmgClassificationPanel = lazySection(() => import('./AcmgClassificationPanel.vue'))
const ActivityLogPanel = lazySection(() => import('./ActivityLogPanel.vue'))
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import {
  ACMG_EVIDENCE_LOCK_HINT,
  type AcmgClassification
} from '../../../shared/config/domain.config'
import { ACMG_COLORS, ACMG_ABBREV, ACMG_CLASSIFICATIONS } from '../composables/useAnnotations'
import { getPerCaseByVariantId, variantKey as toCoordKey } from '../composables/annotation-cache'
import { mdiClipboardCheckOutline, mdiClose, mdiHistory } from '@mdi/js'
import { isWebRuntime } from '../utils/runtime-mode'
import { useCapabilityStore } from '../stores/capabilityStore'
import { usePermissions } from '../composables/usePermissions'
import { useVariantGenomeBuild } from '../composables/useVariantGenomeBuild'

const { canWrite } = usePermissions()

interface Props {
  open: boolean
  variant: Variant | CohortVariant | null
  caseId: number | null
  mode: 'case' | 'cohort'
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'variant-updated': []
}>()

// Move focus into the panel on open; restore it to the originating row on close
const headingRef = ref<HTMLElement | null>(null)
usePanelFocus(() => props.open, headingRef)
const heading = computed(() => variantHeading(props.variant))
const scrollRef = ref<HTMLElement | null>(null)
// Keyed on the locus (case and cohort rows alike), so a refresh does not jump
watch(
  () =>
    props.variant
      ? [props.variant.chr, props.variant.pos, props.variant.ref, props.variant.alt].join(':')
      : null,
  () => scrollRef.value?.scrollTo({ top: 0 })
)
const genomeBuild = useVariantGenomeBuild(props)

const appState = inject(AppStateKey, null)

// External lookups: always on in desktop; an admin-controlled, default-off
// server setting in web; read from the capability document (fail-closed).
const capabilities = useCapabilityStore()
const vepFetchAvailable = computed(() => capabilities.canUse('vepEnrichment'))

// The protein view is the shell's (ProteinViewHost), shared with the row menu and `p`.
function openProteinView(tab: ProteinViewTab): void {
  if (props.variant !== null) appState?.openProteinView(props.variant, tab)
}

function handleTagsChanged(): void {
  if (isWebRuntime()) emit('variant-updated')
}

const { panelWidth, startResize } = usePanelResize()

// Docked beside the table at >= 1440 px (v-main shrinks, nothing is covered);
// an overlay below that, capped at min(800px, 45vw); full width when narrow.
const { detailPanelFullWidth, detailPanelDocked, width: displayWidth } = useResponsiveLayout()
const effectiveWidth = computed(() =>
  detailPanelFullWidth.value
    ? displayWidth.value
    : clampDetailPanelWidth(panelWidth.value, displayWidth.value)
)

const {
  loadAnnotations,
  loadGlobalAnnotations,
  getAcmgClassification,
  getGlobalAcmgClassification,
  getAcmgEvidence,
  getGlobalAcmgEvidence
} = useAnnotations({ genomeBuild })
// The panel sits outside the views: its comments section reads this variant's build.
provide(AnnotationBuildKey, genomeBuild)
// ACMG writes go through the undo-snackbar wrappers (same signatures)
const {
  setAcmgClassification,
  setAcmgClassificationWithEvidence,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence
} = useAcmgUndo({ genomeBuild })

// Use VEP enrichment composable (fetches VEP, myvariant.info, and SpliceAI in parallel)
const {
  vepLoading,
  isOffline,
  isCached,
  cachedAt,
  preferredTranscript,
  allTranscripts,
  colocatedVariants,
  mostSevereConsequence,
  revelScore,
  alphamissenseScore,
  spliceaiMaxDelta,
  isLoading,
  fetchVep,
  clearData: clearVepData
} = useVepEnrichment()

// Global ACMG classification (for showing in case mode)
const globalAcmgClassification = computed<AcmgClassification | null>(() => {
  if (props.variant === null) return null
  return getGlobalAcmgClassification(
    props.variant.chr,
    props.variant.pos,
    props.variant.ref,
    props.variant.alt
  )
})

// A global history is keyed by build (#577); entries from before applied to every build.
const auditEntityKeys = computed<string[]>(() => {
  if (!props.variant) return []
  if (props.mode === 'case' && props.caseId !== null && 'id' in props.variant) {
    return [`case:${props.caseId}:variant:${(props.variant as Variant).id}`]
  }
  const legacy = globalAnnotationEntityKey(props.variant)
  return genomeBuild.value === null
    ? [legacy]
    : [globalAnnotationEntityKey(props.variant, genomeBuild.value), legacy]
})

const hasGlobalAcmg = computed(() => globalAcmgClassification.value !== null)

// prettier-ignore
const currentAcmgEvidence = computed(() => {
  if (!props.variant) return null
  const { chr, pos, ref: r, alt: a } = props.variant
  const vid = 'id' in props.variant ? props.variant.id : undefined
  if (props.mode === 'case') {
    if (props.caseId !== null && typeof vid === 'number') {
      return getPerCaseByVariantId(props.caseId, vid, toCoordKey(props.variant))?.acmg_evidence ?? null
    }
    return getAcmgEvidence(chr, pos, r, a)
  }
  return getGlobalAcmgEvidence(chr, pos, r, a)
})
const hasAcmgEvidence = computed(() => hasMeaningfulAcmgEvidence(currentAcmgEvidence.value))
const acmgLocked = computed(() => hasDecidingAcmgEvidence(currentAcmgEvidence.value))

const {
  currentVariantData,
  variantKey,
  suggestedAcmgCodes,
  acmgExpanded,
  acmgPanelRef,
  handleApplySuggestionsPreview
} = useVariantAcmgPreview({
  variant: computed(() => props.variant),
  caseId: computed(() => props.caseId),
  revelFallback: revelScore,
  spliceAiFallback: spliceaiMaxDelta
})

// prettier-ignore
const currentQuickClassification = computed<AcmgClassification | null>(() => {
  if (!props.variant) return null
  const { chr, pos, ref: r, alt: a } = props.variant
  const vid = 'id' in props.variant ? props.variant.id : undefined
  if (props.mode === 'case' && props.caseId !== null && typeof vid === 'number') {
    return getPerCaseByVariantId(props.caseId, vid, toCoordKey(props.variant))?.acmg_classification ?? null
  }
  return props.mode === 'case' ? getAcmgClassification(chr, pos, r, a) : getGlobalAcmgClassification(chr, pos, r, a)
})

const handleQuickClassify = async (classification: AcmgClassification | null): Promise<void> => {
  if (props.variant === null || acmgLocked.value) return
  const val = classification === currentQuickClassification.value ? null : classification
  const { chr, pos, ref: r, alt: a } = props.variant
  if (props.mode === 'case' && props.caseId !== null) {
    await setAcmgClassification(props.caseId, (props.variant as Variant).id, chr, pos, r, a, val)
  } else {
    await setGlobalAcmgClassification(chr, pos, r, a, val)
  }
}

// prettier-ignore
const handleAcmgEvidenceChange = async (payload: { classification: AcmgClassification | null; evidenceJson: string }): Promise<boolean> => {
  if (props.variant === null) return false
  const { chr, pos, ref: r, alt: a } = props.variant
  return props.mode === 'case' && props.caseId !== null
    ? setAcmgClassificationWithEvidence(props.caseId, (props.variant as Variant).id, chr, pos, r, a, payload.classification, payload.evidenceJson)
    : setGlobalAcmgClassificationWithEvidence(chr, pos, r, a, payload.classification, payload.evidenceJson)
}

// Load annotations when variant changes
// prettier-ignore
watch(
  () => props.variant,
  async (newVariant) => {
    if (newVariant !== null) {
      clearVepData()
      const vid = 'id' in newVariant && typeof newVariant.id === 'number' ? newVariant.id : undefined
      if (props.mode === 'case' && props.caseId !== null) {
        await loadAnnotations(props.caseId, newVariant.chr, newVariant.pos, newVariant.ref, newVariant.alt, vid)
      } else {
        await loadGlobalAnnotations(newVariant.chr, newVariant.pos, newVariant.ref, newVariant.alt)
      }
    }
  },
  { immediate: true }
)

appState?.setPanelLeaveGuard(() => acmgPanelRef.value?.confirmLeave() ?? null)

// Escape closes the panel, unless a text field or an open menu/dialog owns it
const handleKeydown = (e: KeyboardEvent): void => {
  if (e.key !== 'Escape' || !props.open || isTextEntryFocused() || isOverlayOpen()) return
  e.preventDefault()
  emit('update:open', false)
}
onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  appState?.setPanelLeaveGuard(null)
})
</script>

<style scoped>
.panel-heading {
  font: inherit;
  margin: 0;
}

.panel-heading:focus {
  outline: none;
}

.panel-heading:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
}

.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  background: transparent;
  z-index: 10;
}

.resize-handle:hover {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 20%, transparent);
}

.cursor-pointer {
  cursor: pointer;
}
</style>
