<template>
  <v-navigation-drawer
    :model-value="open"
    location="right"
    temporary
    :persistent="true"
    :scrim="false"
    :width="panelWidth"
    @update:model-value="emit('update:open', $event)"
  >
    <!-- Resize handle (left edge) -->
    <div class="resize-handle" @mousedown="startResize" />

    <v-card flat class="h-100 d-flex flex-column">
      <!-- Header with title and close button -->
      <v-toolbar color="transparent" density="compact" flat>
        <v-toolbar-title class="text-subtitle-1"> Variant Details </v-toolbar-title>
        <v-btn icon size="small" @click="emit('update:open', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>

      <v-divider />

      <!-- Scrollable content area -->
      <div class="flex-grow-1 overflow-y-auto pa-3">
        <template v-if="variant">
          <!-- Section 1: Variant Identity -->
          <VariantIdentitySection
            :variant="variant"
            :colocated-variants="colocatedVariants"
            class="mb-4"
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
          <div v-if="mostSevereConsequence" class="text-caption mb-2">
            <v-chip size="x-small" :color="getConsequenceColor(mostSevereConsequence)" label>
              {{ formatConsequence(mostSevereConsequence) }}
            </v-chip>
          </div>

          <div v-if="isCached && cachedAt" class="text-caption text-grey mb-2">
            Cached from {{ cachedAt.toLocaleDateString() }}
          </div>

          <v-divider class="mb-4" />

          <!-- Section 3: ACMG Classification -->
          <div class="acmg-section mb-4">
            <div class="text-subtitle-2 mb-2">ACMG Classification</div>
            <AcmgMenu @select="handleAcmgSelect">
              <template #activator="{ props: menuProps }">
                <v-chip
                  v-if="currentAcmgClassification !== null"
                  v-bind="menuProps"
                  :color="ACMG_COLORS[currentAcmgClassification]"
                  label
                  class="cursor-pointer"
                >
                  {{ currentAcmgClassification }}
                </v-chip>
                <v-btn
                  v-else
                  v-bind="menuProps"
                  variant="outlined"
                  size="small"
                  prepend-icon="mdi-tag-plus"
                >
                  Set Classification
                </v-btn>
              </template>
            </AcmgMenu>
            <div v-if="hasGlobalAcmg && mode === 'case'" class="text-caption text-grey mt-1">
              Global: {{ globalAcmgClassification }}
            </div>
          </div>

          <v-divider class="mb-4" />

          <!-- Section 4: Comments -->
          <CommentsSection :variant="variant" :case-id="caseId" :mode="mode" class="mb-4" />

          <v-divider class="mb-4" />

          <!-- Section 5: External Links -->
          <ExternalLinksSection :variant="variant" />
        </template>

        <div v-else class="text-grey text-center mt-4">Select a variant to view details</div>
      </div>
    </v-card>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
/* global window */
import { onMounted, onUnmounted, computed, watch } from 'vue'
import { usePanelResize } from '../composables/usePanelResize'
import { useAnnotations, ACMG_COLORS } from '../composables/useAnnotations'
import { useVepEnrichment } from '../composables/useVepEnrichment'
import VariantIdentitySection from './VariantIdentitySection.vue'
import AnnotationScoresSection from './AnnotationScoresSection.vue'
import ExternalLinksSection from './ExternalLinksSection.vue'
import CommentsSection from './CommentsSection.vue'
import AcmgMenu from './AcmgMenu.vue'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type { AcmgClassification } from '../../../main/database/types'

interface Props {
  open: boolean
  variant: Variant | CohortVariant | null
  caseId: number | null
  mode: 'case' | 'cohort'
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

// Use panel resize composable
const { panelWidth, startResize } = usePanelResize()

// Use annotations composable
const {
  loadAnnotations,
  loadGlobalAnnotations,
  getAcmgClassification,
  getGlobalAcmgClassification,
  setAcmgClassification,
  setGlobalAcmgClassification
} = useAnnotations()

// Use VEP enrichment composable (fetches VEP, myvariant.info, and SpliceAI in parallel)
const {
  vepLoading,
  isOffline,
  isCached,
  cachedAt,
  preferredTranscript,
  colocatedVariants,
  mostSevereConsequence,
  revelScore,
  alphamissenseScore,
  spliceaiMaxDelta,
  isLoading,
  fetchVep
} = useVepEnrichment()

// Current ACMG classification (per-case in case mode, global in cohort mode)
const currentAcmgClassification = computed<AcmgClassification | null>(() => {
  if (props.variant === null) return null

  if (props.mode === 'case') {
    return getAcmgClassification(
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt
    )
  } else {
    return getGlobalAcmgClassification(
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt
    )
  }
})

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

// Check if global ACMG exists
const hasGlobalAcmg = computed(() => {
  return globalAcmgClassification.value !== null
})

// Handle ACMG selection
const handleAcmgSelect = async (classification: AcmgClassification | null) => {
  if (props.variant === null) return

  if (props.mode === 'case' && props.caseId !== null) {
    // Per-case classification
    const variantId = (props.variant as Variant).id
    await setAcmgClassification(
      props.caseId,
      variantId,
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt,
      classification
    )
  } else {
    // Global classification (cohort mode)
    await setGlobalAcmgClassification(
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt,
      classification
    )
  }
}

// Load annotations when variant changes
watch(
  () => props.variant,
  async (newVariant) => {
    if (newVariant !== null) {
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

      // Fetch VEP enrichment
      await fetchVep(newVariant.chr, newVariant.pos, newVariant.ref, newVariant.alt)
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
  background: rgba(var(--v-theme-primary), 0.2);
}

.cursor-pointer {
  cursor: pointer;
}
</style>
