<template>
  <div class="gene-structure-panel d-flex flex-column fill-height">
    <!-- Toolbar -->
    <v-toolbar density="compact" color="secondary" flat class="gene-structure-toolbar">
      <div class="d-flex align-center ga-1 px-2 flex-wrap">
        <!-- Zoom controls -->
        <v-tooltip location="bottom">
          <template #activator="{ props: tip }">
            <v-btn
              aria-label="Zoom in"
              v-bind="tip"
              icon
              size="small"
              variant="text"
              @click="nav.zoom(ZOOM_STEP)"
            >
              <v-icon size="small" :icon="mdiMagnifyPlusOutline" />
            </v-btn>
          </template>
          Zoom in
        </v-tooltip>

        <v-tooltip location="bottom">
          <template #activator="{ props: tip }">
            <v-btn
              aria-label="Zoom out"
              v-bind="tip"
              icon
              size="small"
              variant="text"
              @click="nav.zoom(1 / ZOOM_STEP)"
            >
              <v-icon size="small" :icon="mdiMagnifyMinusOutline" />
            </v-btn>
          </template>
          Zoom out
        </v-tooltip>

        <v-tooltip location="bottom">
          <template #activator="{ props: tip }">
            <v-btn
              aria-label="Reset zoom"
              v-bind="tip"
              icon
              size="small"
              variant="text"
              @click="nav.reset()"
            >
              <v-icon size="small" :icon="mdiFitToScreenOutline" />
            </v-btn>
          </template>
          Reset zoom
        </v-tooltip>

        <v-divider vertical class="mx-1" />

        <!-- Info chips -->
        <v-chip v-if="geneStructure" size="small" variant="outlined" class="mr-1">
          {{ geneStructure.exons.length }} exons
        </v-chip>
        <v-chip v-if="geneStructure" size="small" variant="outlined">
          {{ formatGeneLength(geneStructure.end - geneStructure.start) }}
        </v-chip>

        <v-divider vertical class="mx-1" />

        <!-- Export buttons -->
        <v-tooltip location="bottom">
          <template #activator="{ props: tip }">
            <v-btn
              aria-label="Export SVG"
              v-bind="tip"
              icon
              size="small"
              density="default"
              variant="text"
              @click="handleExportSvg"
            >
              <v-icon size="small" :icon="mdiFileImageOutline" />
            </v-btn>
          </template>
          Export SVG
        </v-tooltip>

        <v-tooltip location="bottom">
          <template #activator="{ props: tip }">
            <v-btn
              aria-label="Export PNG"
              v-bind="tip"
              icon
              size="small"
              density="default"
              variant="text"
              @click="handleExportPng"
            >
              <v-icon size="small" :icon="mdiImageOutline" />
            </v-btn>
          </template>
          Export PNG
        </v-tooltip>
      </div>
    </v-toolbar>

    <!-- Loading bar -->
    <TrackLoadingBar :active="loading || clinvarLoading" label="Loading gene structure" />

    <!-- Genome-build context (#539): the gene model is GRCh38 -->
    <v-alert
      v-if="variant && buildNote"
      type="warning"
      variant="tonal"
      density="compact"
      class="ma-2"
      data-testid="gene-structure-build-note"
    >
      {{ buildNote }}
    </v-alert>

    <!-- Error state -->
    <div v-if="error" class="d-flex flex-column align-center justify-center flex-grow-1 pa-8">
      <v-icon size="48" color="warning" :icon="mdiAlertCircleOutline" class="mb-3" />
      <div class="text-body-1 mb-1">{{ PLOT_COPY.geneStructureUnavailable }}</div>
      <div class="text-body-2 text-medium-emphasis mb-3">
        {{ PLOT_COPY.geneStructureSource }} {{ error }}
      </div>
      <v-btn
        variant="outlined"
        color="primary"
        size="small"
        class="text-none"
        @click="emit('retry')"
      >
        {{ PLOT_COPY.retry }}
      </v-btn>
    </div>

    <!-- No data state -->
    <div
      v-else-if="!geneStructure && !loading"
      class="d-flex flex-column align-center justify-center flex-grow-1 pa-8"
    >
      <v-icon size="48" color="grey" :icon="mdiDna" class="mb-3" />
      <div class="text-body-1 mb-1">No Gene Structure Data</div>
      <div class="text-body-2 text-medium-emphasis">
        Exon coordinates could not be loaded from Ensembl.
      </div>
    </div>

    <!-- Caption, search, plot + overview, neighbourhood of the variant of interest -->
    <TrackView
      v-else-if="geneStructure"
      ref="plotRef"
      class="flex-grow-1"
      :nav="nav"
      unit="bp"
      :caption="
        geneCaption(
          geneStructure.geneSymbol,
          geneStructure.exons.length,
          geneStructure.transcriptId
        )
      "
      :plot-label="`Gene structure of ${geneStructure.geneSymbol}`"
      :search-label="PLOT_COPY.geneSearchLabel"
      :search-context="searchContext"
      :extent="extent"
      :features="track.features"
      :between-label="PLOT_COPY.betweenExons"
      :no-features-label="PLOT_COPY.noExons"
      :search-hint="PLOT_COPY.geneSearchHint"
      :draw="(ctx) => viewModel && drawGeneView(ctx, viewModel)"
      :deps="viewModel"
    />

    <!-- Legend -->
    <v-theme-provider
      v-if="geneStructure"
      theme="warmLight"
      with-background
      class="gene-structure-legend pa-2 bg-grey-lighten-4"
    >
      <div class="d-flex align-center ga-1 flex-wrap mb-1">
        <span class="text-body-2 text-medium-emphasis mr-1 font-weight-medium">Legend:</span>
        <v-chip size="small" label variant="flat" color="primary">Exon</v-chip>
        <v-chip size="small" label variant="outlined" color="grey-darken-2">Intron</v-chip>
        <v-chip v-if="genomicVariant" size="small" label variant="flat" color="error">{{
          isInterval(genomicVariant)
            ? 'Your Variant (interval; outlined exons affected)'
            : 'Your Variant'
        }}</v-chip>
        <span v-if="clinvarVariants.length > 0" class="d-inline-flex align-center ga-1 ml-2">
          <ClinVarMark cls="pathogenic" :color="CLINVAR_COLORS.pathogenic" />
          <span class="text-body-2">ClinVar</span>
        </span>
      </div>

      <!-- ClinVar significance filter row -->
      <div v-if="clinvarVariants.length > 0" class="d-flex flex-wrap ga-1 align-center">
        <span
          class="text-body-2 text-medium-emphasis mr-1 font-weight-medium"
          style="min-width: 140px"
          >ClinVar Significance:</span
        >
        <div
          v-for="[category, color] in clinvarEntries"
          :key="category"
          class="filter-pill"
          :class="{ inactive: !isClinVarActive(category) }"
        >
          <v-chip
            size="small"
            label
            :variant="isClinVarActive(category) ? 'flat' : 'outlined'"
            :style="clinvarChipStyle(category, color)"
            class="cursor-pointer"
            @click="toggleClinVar(category)"
          >
            <ClinVarMark :cls="category" class="mr-1" />
            {{ CLINVAR_LABELS[category] }}
            ({{ clinvarCounts[category] ?? 0 }})
          </v-chip>
          <v-btn
            size="x-small"
            variant="text"
            class="only-btn text-none"
            @click.stop="selectOnlyClinVar(category)"
          >
            only
          </v-btn>
        </div>
        <v-chip
          size="small"
          label
          variant="outlined"
          color="grey-darken-1"
          class="ml-2"
          @click="selectAllClinVar()"
        >
          All
        </v-chip>
      </div>
    </v-theme-provider>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  mdiMagnifyPlusOutline,
  mdiMagnifyMinusOutline,
  mdiFitToScreenOutline,
  mdiFileImageOutline,
  mdiImageOutline,
  mdiAlertCircleOutline,
  mdiDna
} from '@mdi/js'
import TrackView from './track/TrackView.vue'
import TrackLoadingBar from './track/TrackLoadingBar.vue'
import { drawGeneView } from '../../composables/track-plot/gene-view'
import { useTrackNavigator } from '../../composables/useTrackNavigator'
import { PLOT_COPY, ZOOM_STEP, geneCaption } from '../../config/proteinPlotConfig'
import { geneTrackData, isInterval, type GenomicVariant } from '../../utils/track-markers'
import type {
  GeneStructure,
  ClinVarVariant,
  ClinVarSignificance,
  LollipopVariant
} from '../../../../shared/types/protein'
import { CLINVAR_COLORS, getClinVarCategory } from '../../../../shared/utils/protein-utils'
import ClinVarMark from './ClinVarMark.vue'
import { readableTextOn } from '../../utils/readable-text-color'
import { downloadBlob } from '../../utils/download'
import { buildStatus, variantBuildNote } from '../../utils/variant-interval'

interface Props {
  geneStructure: GeneStructure | null
  loading: boolean
  error: string | null
  /** Variant to display on gene structure */
  variant: GenomicVariant | null
  /** The variant's genome build; a variant on another build is not drawn */
  variantBuild?: string | null
  geneSymbol: string | null
  /** ClinVar variants to display on gene structure */
  clinvarVariants: ClinVarVariant[]
  /** Whether ClinVar data is loading */
  clinvarLoading: boolean
  /** Case variants / cohort carriers of the gene (the lollipop's variants) */
  variants?: LollipopVariant[]
}

const props = withDefaults(defineProps<Props>(), { variantBuild: null, variants: () => [] })
const emit = defineEmits<{ retry: [] }>()

// ClinVar significance filter - all active by default
const activeClinvarCategories = ref<Set<ClinVarSignificance>>(
  new Set(Object.keys(CLINVAR_COLORS) as ClinVarSignificance[])
)

const CLINVAR_LABELS: Record<ClinVarSignificance, string> = {
  pathogenic: 'Pathogenic',
  likely_pathogenic: 'Likely P.',
  uncertain: 'VUS',
  likely_benign: 'Likely B.',
  benign: 'Benign',
  other: 'Other'
}

/** Compute ClinVar variant counts per significance category (only those with genomic position) */
const clinvarCounts = computed(() => {
  const counts: Record<ClinVarSignificance, number> = {
    pathogenic: 0,
    likely_pathogenic: 0,
    uncertain: 0,
    likely_benign: 0,
    benign: 0,
    other: 0
  }
  for (const v of props.clinvarVariants) {
    if (v.genomicPosition !== null) {
      const cat = getClinVarCategory(v.clinicalSignificance)
      counts[cat]++
    }
  }
  return counts
})

function isClinVarActive(category: ClinVarSignificance): boolean {
  return activeClinvarCategories.value.has(category)
}

function toggleClinVar(category: ClinVarSignificance): void {
  const next = new Set(activeClinvarCategories.value)
  if (next.has(category)) {
    next.delete(category)
  } else {
    next.add(category)
  }
  activeClinvarCategories.value = next
}

function selectOnlyClinVar(category: ClinVarSignificance): void {
  activeClinvarCategories.value = new Set([category])
}

function selectAllClinVar(): void {
  activeClinvarCategories.value = new Set(Object.keys(CLINVAR_COLORS) as ClinVarSignificance[])
}

function clinvarChipStyle(category: ClinVarSignificance, color: string): Record<string, string> {
  if (isClinVarActive(category)) {
    return { backgroundColor: color, color: readableTextOn(color), borderColor: color }
  }
  return { borderColor: color, color, opacity: '0.6' }
}

const clinvarEntries = computed(
  () => Object.entries(CLINVAR_COLORS) as [ClinVarSignificance, string][]
)

const plotRef = ref<InstanceType<typeof TrackView> | null>(null)

const buildNote = computed(() => variantBuildNote(props.variantBuild))
// Coordinates on another build would land on the wrong exons, so they are not drawn.
const genomicVariant = computed<GenomicVariant | null>(() =>
  buildStatus(props.variantBuild) === 'mismatch' ? null : props.variant
)

// ── The plot's markers, navigator and drawing model ──────────────────────
const track = computed(() =>
  geneTrackData({
    variants: genomicVariant.value === null && props.variant !== null ? [] : props.variants,
    clinvar: props.clinvarVariants.filter((cv) =>
      activeClinvarCategories.value.has(getClinVarCategory(cv.clinicalSignificance))
    ),
    exons: props.geneStructure?.exons ?? [],
    anchor: genomicVariant.value
  })
)
// The gene with a 2 % margin, so the first and last exon do not sit on the edge.
const extent = computed(() => {
  const gs = props.geneStructure
  if (gs === null) return { start: 0, end: 1 }
  const pad = Math.max(1, (gs.end - gs.start) * 0.02)
  return { start: gs.start - pad, end: gs.end + pad }
})
const nav = useTrackNavigator({
  view: 'gene',
  extent,
  markers: computed(() => track.value.markers),
  features: computed(() => track.value.features)
})
const clipId = `gene-clip-${Math.random().toString(36).slice(2, 8)}`
const viewModel = computed(() =>
  props.geneStructure === null
    ? null
    : {
        clipId,
        gene: props.geneStructure,
        anchorVariant: genomicVariant.value,
        axisNote: props.variant ? buildNote.value : null,
        cohort: props.variants.some((v) => v.carrierCount !== undefined),
        hasClinvar: props.clinvarVariants.some((cv) => cv.genomicPosition !== null)
      }
)
const searchContext = computed(() => ({
  view: 'gene' as const,
  markers: nav.displayMarkers.value,
  features: track.value.features
}))

function formatGeneLength(bp: number): string {
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(1)} Mb`
  if (bp >= 1_000) return `${(bp / 1_000).toFixed(1)} kb`
  return `${bp} bp`
}

function handleExportSvg(): void {
  const svgString: string | undefined = plotRef.value?.exportSvg()
  if (svgString === undefined || svgString === '') return

  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  downloadBlob(blob, `${props.geneSymbol ?? 'gene'}_structure.svg`)
}

async function handleExportPng(): Promise<void> {
  const blob: Blob | null | undefined = await plotRef.value?.exportPng()
  if (blob === null || blob === undefined) return

  downloadBlob(blob, `${props.geneSymbol ?? 'gene'}_structure.png`)
}
</script>

<style scoped>
.gene-structure-legend {
  border-top: 1px solid #e0e0e0;
}

.cursor-pointer {
  cursor: pointer;
}

.filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.filter-pill.inactive {
  opacity: 0.5;
}

.only-btn {
  font-size: 10px;
  min-width: 32px;
  height: 20px;
  padding: 0 4px;
  text-transform: lowercase;
  opacity: 0.6;
}

.only-btn:hover {
  opacity: 1;
}
</style>
