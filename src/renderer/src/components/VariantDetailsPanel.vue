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
    <!-- Resize handle (left edge) -->
    <div class="resize-handle" @mousedown="startResize" />

    <v-card flat class="h-100 d-flex flex-column">
      <!-- Header with title and close button -->
      <v-toolbar color="transparent" density="compact" flat>
        <v-toolbar-title class="text-body-large">
          <h2 ref="headingRef" tabindex="-1" class="panel-heading">Variant Details</h2>
        </v-toolbar-title>
        <IconButton
          label="Close variant details"
          :icon="mdiClose"
          @click="emit('update:open', false)"
        />
      </v-toolbar>

      <v-divider />

      <!-- Scrollable content area -->
      <div class="flex-grow-1 overflow-y-auto pa-3">
        <!-- Skeleton loader while variant details are loading -->
        <v-skeleton-loader
          v-if="variant && isLoading"
          type="card-heading, list-item-three-line@4"
          class="variant-details-skeleton"
        />

        <template v-else-if="variant">
          <!-- Section 1: Variant Identity -->
          <VariantIdentitySection
            :variant="variant"
            :colocated-variants="colocatedVariants"
            class="mb-4"
            @open-protein-view="openProteinView"
          />

          <!-- Extension details for SV/CNV/STR variants -->
          <ExtensionDetailsSection :variant="variant as unknown as Record<string, unknown>" />

          <!-- Transcript Section (case + cohort mode) -->
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

          <!-- Section 2: Annotation Scores -->
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

          <!-- VEP metadata (consequence + cache indicator) -->
          <div v-if="mostSevereConsequence" class="text-body-small mb-2">
            <v-chip size="x-small" :color="getConsequenceColor(mostSevereConsequence)" label>
              {{ formatConsequence(mostSevereConsequence) }}
            </v-chip>
          </div>

          <div v-if="isCached && cachedAt" class="text-body-small text-muted mb-2">
            Cached from {{ cachedAt.toLocaleDateString() }}
          </div>

          <v-divider class="mb-4" />

          <!-- Section 3: ACMG Classification -->
          <div class="acmg-section mb-4">
            <h3 class="text-title-small mb-2">ACMG Classification</h3>

            <!-- Quick-classify chips -->
            <div class="d-flex flex-wrap ga-1 mb-2">
              <v-chip
                v-for="cls in ACMG_CLASSIFICATIONS"
                :key="cls"
                :color="currentQuickClassification === cls ? ACMG_COLORS[cls] : undefined"
                :variant="currentQuickClassification === cls ? 'flat' : 'outlined'"
                size="small"
                label
                class="cursor-pointer"
                :disabled="!canWrite"
                @click="handleQuickClassify(cls)"
              >
                {{ ACMG_ABBREV[cls] }}
              </v-chip>
              <v-chip
                v-if="currentQuickClassification && canWrite"
                variant="text"
                size="small"
                class="cursor-pointer text-medium-emphasis"
                aria-label="Clear classification"
                @click="handleQuickClassify(null)"
              >
                <v-icon size="x-small" :icon="mdiClose" />
              </v-chip>
            </div>

            <!-- Evidence-based classification panel -->
            <v-expansion-panels v-if="canWrite" variant="accordion" class="mb-1">
              <v-expansion-panel>
                <v-expansion-panel-title class="text-body-2 pa-2">
                  <v-icon size="small" class="mr-1" :icon="mdiClipboardCheckOutline" />
                  Evidence editor
                  <span v-if="hasAcmgEvidence" class="text-caption text-medium-emphasis ml-1">
                    (has evidence)
                  </span>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <AcmgClassificationPanel
                    :evidence-json="currentAcmgEvidence"
                    :variant-data="currentVariantData"
                    :save="handleAcmgEvidenceChange"
                  />
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>

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
                <ActivityLogPanel :entity-key="auditEntityKey" />
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>

          <v-divider class="mb-4" />

          <!-- Section 7: External Links -->
          <ExternalLinksSection :variant="variant" />
        </template>

        <div v-else class="text-muted text-center mt-4">Select a variant to view details</div>
      </div>

      <!-- Protein Visualization Modal: mounted on first open only. Rendering it
           closed still fetched its chunk and fired protein/ClinVar requests on
           every variant change. -->
      <ProteinVisualizationModal
        v-if="proteinViewerAvailable && proteinModalMounted"
        v-model="proteinModalOpen"
        :variant="variant"
        :case-id="caseId"
        :mode="mode"
      />
      <ProteinViewUnavailableDialog
        v-else-if="!proteinViewerAvailable"
        v-model="proteinModalOpen"
        :reason="capabilities.capabilityReason('proteinViewer')"
      />
    </v-card>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, defineAsyncComponent } from 'vue'
import { usePanelResize } from '../composables/usePanelResize'
import { useResponsiveLayout } from '../composables/useResponsiveLayout'
import { clampDetailPanelWidth } from '../utils/responsive-layout'
import { formatConsequence } from '../utils/formatters'
import { useAnnotations } from '../composables/useAnnotations'
import { useAcmgUndo } from '../composables/useAcmgUndo'
import { hasMeaningfulAcmgEvidence } from '../utils/acmg/acmg-undo'
import { useVepEnrichment } from '../composables/useVepEnrichment'
import VariantIdentitySection from './VariantIdentitySection.vue'
import IconButton from './common/IconButton.vue'
import { usePanelFocus } from '../composables/usePanelFocus'
import AnnotationScoresSection from './AnnotationScoresSection.vue'
import TranscriptSection from './TranscriptSection.vue'
import ExtensionDetailsSection from './variant-details/ExtensionDetailsSection.vue'

// Lazy-load non-critical panel sections to speed up initial open
import SectionSkeleton from './SectionSkeleton.vue'

const asyncOpts = { delay: 0, loadingComponent: SectionSkeleton }

const ExternalLinksSection = defineAsyncComponent({
  loader: () => import('./ExternalLinksSection.vue'),
  ...asyncOpts
})
const CommentsSection = defineAsyncComponent({
  loader: () => import('./CommentsSection.vue'),
  ...asyncOpts
})
const TagsSection = defineAsyncComponent({
  loader: () => import('./TagsSection.vue'),
  ...asyncOpts
})
const AcmgClassificationPanel = defineAsyncComponent({
  loader: () => import('./AcmgClassificationPanel.vue'),
  ...asyncOpts
})
const ActivityLogPanel = defineAsyncComponent({
  loader: () => import('./ActivityLogPanel.vue'),
  ...asyncOpts
})
const ProteinVisualizationModal = defineAsyncComponent({
  loader: () => import('./protein/ProteinVisualizationModal.vue'),
  ...asyncOpts
})
const ProteinViewUnavailableDialog = defineAsyncComponent(
  () => import('./protein/ProteinViewUnavailableDialog.vue')
)
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import { ACMG_COLORS, ACMG_ABBREV, ACMG_CLASSIFICATIONS } from '../composables/useAnnotations'
import { mdiClipboardCheckOutline, mdiClose, mdiHistory } from '@mdi/js'
import { isWebRuntime } from '../utils/runtime-mode'
import { useCapabilityStore } from '../stores/capabilityStore'
import { useMountOnFirstOpen } from '../composables/useMountOnFirstOpen'
import { usePermissions } from '../composables/usePermissions'

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

// Protein visualization modal state
const proteinModalOpen = ref(false)
// External lookups: always on in desktop; an admin-controlled, default-off
// server setting in web; read from the capability document (fail-closed).
const capabilities = useCapabilityStore()
const proteinViewerAvailable = computed(() => capabilities.canUse('proteinViewer'))
const vepFetchAvailable = computed(() => capabilities.canUse('vepEnrichment'))
const proteinModalMounted = useMountOnFirstOpen(() => proteinModalOpen.value)

function openProteinView(): void {
  proteinModalOpen.value = true
}

function handleTagsChanged(): void {
  if (isWebRuntime()) emit('variant-updated')
}

// Use panel resize composable
const { panelWidth, startResize } = usePanelResize()

// Docked beside the table at >= 1440 px (v-main shrinks, nothing is covered);
// an overlay below that, capped at min(800px, 45vw); full width when narrow.
const { detailPanelFullWidth, detailPanelDocked, width: displayWidth } = useResponsiveLayout()
const effectiveWidth = computed(() =>
  detailPanelFullWidth.value
    ? displayWidth.value
    : clampDetailPanelWidth(panelWidth.value, displayWidth.value)
)

// Use annotations composable
const {
  loadAnnotations,
  loadGlobalAnnotations,
  getAcmgClassification,
  getGlobalAcmgClassification,
  getAcmgEvidence,
  getGlobalAcmgEvidence
} = useAnnotations()
// ACMG writes go through the undo-snackbar wrappers (same signatures)
const {
  setAcmgClassification,
  setAcmgClassificationWithEvidence,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence
} = useAcmgUndo()

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

// Audit trail entity key
const auditEntityKey = computed(() => {
  if (!props.variant) return null
  if (props.mode === 'case' && props.caseId !== null && 'id' in props.variant) {
    return `case:${props.caseId}:variant:${(props.variant as Variant).id}`
  }
  return `${props.variant.chr}:${props.variant.pos}:${props.variant.ref}:${props.variant.alt}`
})

const hasGlobalAcmg = computed(() => {
  return globalAcmgClassification.value !== null
})

// Current evidence JSON for the ACMG panel
const currentAcmgEvidence = computed(() => {
  if (!props.variant) return null
  if (props.mode === 'case') {
    return getAcmgEvidence(
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt
    )
  }
  return getGlobalAcmgEvidence(
    props.variant.chr,
    props.variant.pos,
    props.variant.ref,
    props.variant.alt
  )
})
// Stored evidence with every criterion removed is still a JSON blob; only
// say "(has evidence)" when criteria, notes or an override remain.
const hasAcmgEvidence = computed(() => hasMeaningfulAcmgEvidence(currentAcmgEvidence.value))

// Variant annotation data for auto-suggestions
const currentVariantData = computed(() => {
  if (!props.variant) return null
  return {
    gnomad_af: props.variant.gnomad_af ?? null,
    cadd:
      'cadd' in props.variant ? (props.variant.cadd ?? null) : (props.variant.cadd_phred ?? null),
    clinvar: props.variant.clinvar ?? null
  }
})

// Current quick classification (from annotation, not evidence-based)
const currentQuickClassification = computed<AcmgClassification | null>(() => {
  if (!props.variant) return null
  if (props.mode === 'case') {
    return getAcmgClassification(
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt
    )
  }
  return getGlobalAcmgClassification(
    props.variant.chr,
    props.variant.pos,
    props.variant.ref,
    props.variant.alt
  )
})

// Handle quick-classify chip click
const handleQuickClassify = async (classification: AcmgClassification | null): Promise<void> => {
  if (props.variant === null) return
  // Toggle off if already selected
  const value = classification === currentQuickClassification.value ? null : classification

  if (props.mode === 'case' && props.caseId !== null) {
    const variantId = (props.variant as Variant).id
    await setAcmgClassification(
      props.caseId,
      variantId,
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt,
      value
    )
  } else {
    await setGlobalAcmgClassification(
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt,
      value
    )
  }
}

// Handle ACMG evidence change from panel
const handleAcmgEvidenceChange = async (payload: {
  classification: AcmgClassification | null
  evidenceJson: string
}): Promise<boolean> => {
  if (props.variant === null) return false

  if (props.mode === 'case' && props.caseId !== null) {
    const variantId = (props.variant as Variant).id
    return setAcmgClassificationWithEvidence(
      props.caseId,
      variantId,
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt,
      payload.classification,
      payload.evidenceJson
    )
  } else {
    return setGlobalAcmgClassificationWithEvidence(
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt,
      payload.classification,
      payload.evidenceJson
    )
  }
}

// Load annotations when variant changes
watch(
  () => props.variant,
  async (newVariant) => {
    if (newVariant !== null) {
      // Clear stale VEP enrichment data immediately — before any async work,
      // so the UI never shows data from the previous variant
      clearVepData()

      // Load annotations
      if (props.mode === 'case' && props.caseId !== null) {
        await loadAnnotations(
          props.caseId,
          newVariant.chr,
          newVariant.pos,
          newVariant.ref,
          newVariant.alt
        )
      } else {
        await loadGlobalAnnotations(newVariant.chr, newVariant.pos, newVariant.ref, newVariant.alt)
      }
    }
  },
  { immediate: true }
)

// Helper functions for consequence formatting
function getConsequenceColor(consequence: string): string {
  if (
    consequence.includes('frameshift') ||
    consequence.includes('stop_gained') ||
    consequence.includes('splice_donor') ||
    consequence.includes('splice_acceptor')
  ) {
    return 'error'
  }
  if (consequence.includes('missense') || consequence.includes('inframe')) {
    return 'warning'
  }
  return 'grey'
}

// Handle Escape key to close panel
const handleKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && props.open) {
    emit('update:open', false)
  }
}

// Add Escape listener on mount
onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

// Clean up Escape listener on unmount
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
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
