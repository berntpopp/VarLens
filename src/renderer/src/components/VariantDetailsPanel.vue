<template>
  <v-navigation-drawer
    :model-value="open"
    location="right"
    temporary
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
        <v-toolbar-title class="text-body-large"> Variant Details </v-toolbar-title>
        <v-btn icon size="small" @click="emit('update:open', false)">
          <v-icon :icon="mdiClose" />
        </v-btn>
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
            :fetch-vep="fetchVep"
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

          <div v-if="isCached && cachedAt" class="text-body-small text-grey mb-2">
            Cached from {{ cachedAt.toLocaleDateString() }}
          </div>

          <v-divider class="mb-4" />

          <!-- Section 3: ACMG Classification -->
          <div class="acmg-section mb-4">
            <div class="text-title-small mb-2">ACMG Classification</div>

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
                @click="handleQuickClassify(cls)"
              >
                {{ ACMG_ABBREV[cls] }}
              </v-chip>
              <v-chip
                v-if="currentQuickClassification"
                variant="text"
                size="small"
                class="cursor-pointer text-medium-emphasis"
                @click="handleQuickClassify(null)"
              >
                <v-icon size="x-small" :icon="mdiClose" />
              </v-chip>
            </div>

            <!-- Evidence-based classification panel -->
            <v-expansion-panels variant="accordion" class="mb-1">
              <v-expansion-panel>
                <v-expansion-panel-title class="text-body-2 pa-2">
                  <v-icon size="small" class="mr-1" :icon="mdiClipboardCheckOutline" />
                  Evidence editor
                  <span v-if="currentAcmgEvidence" class="text-caption text-medium-emphasis ml-1">
                    (has evidence)
                  </span>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <AcmgClassificationPanel
                    :evidence-json="currentAcmgEvidence"
                    :variant-data="currentVariantData"
                    @change="handleAcmgEvidenceChange"
                  />
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>

            <div v-if="hasGlobalAcmg && mode === 'case'" class="text-body-small text-grey mt-1">
              Global: {{ globalAcmgClassification }}
            </div>
          </div>

          <v-divider class="mb-4" />

          <!-- Section 4: Tags (case mode only) -->
          <template v-if="mode === 'case' && caseId !== null && 'id' in variant">
            <TagsSection :case-id="caseId" :variant-id="(variant as Variant).id" class="mb-4" />
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

        <div v-else class="text-grey text-center mt-4">Select a variant to view details</div>
      </div>

      <!-- Protein Visualization Modal -->
      <ProteinVisualizationModal
        v-model="proteinModalOpen"
        :variant="variant"
        :case-id="caseId"
        :mode="mode"
      />
    </v-card>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, defineAsyncComponent } from 'vue'
import { usePanelResize } from '../composables/usePanelResize'
import { useResponsiveLayout } from '../composables/useResponsiveLayout'
import { useAnnotations } from '../composables/useAnnotations'
import { useVepEnrichment } from '../composables/useVepEnrichment'
import VariantIdentitySection from './VariantIdentitySection.vue'
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
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import { ACMG_COLORS, ACMG_ABBREV, ACMG_CLASSIFICATIONS } from '../composables/useAnnotations'
import { mdiClipboardCheckOutline, mdiClose, mdiHistory } from '@mdi/js'

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

// Protein visualization modal state
const proteinModalOpen = ref(false)

function openProteinView(): void {
  proteinModalOpen.value = true
}

// Use panel resize composable
const { panelWidth, startResize } = usePanelResize()

// Use responsive layout composable
const { detailPanelFullWidth, width: displayWidth } = useResponsiveLayout()
const effectiveWidth = computed(() =>
  detailPanelFullWidth.value ? displayWidth.value : panelWidth.value
)

// Use annotations composable
const {
  loadAnnotations,
  loadGlobalAnnotations,
  getAcmgClassification,
  getGlobalAcmgClassification,
  getAcmgEvidence,
  getGlobalAcmgEvidence,
  setAcmgClassification,
  setAcmgClassificationWithEvidence,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence
} = useAnnotations()

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
}) => {
  if (props.variant === null) return

  if (props.mode === 'case' && props.caseId !== null) {
    const variantId = (props.variant as Variant).id
    await setAcmgClassificationWithEvidence(
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
    await setGlobalAcmgClassificationWithEvidence(
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

function formatConsequence(consequence: string): string {
  return consequence.replace(/_/g, ' ')
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
