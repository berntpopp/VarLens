<template>
  <!--
    DEPRECATED: This component is no longer used.
    CohortDataTable.vue now uses shared cell components directly from table-cells/.
    This file is kept for reference until the next major version.
    DO NOT modify or extend this component.
  -->
  <div>
    <!-- Annotations column (star, ACMG, comment) -->
    <div v-if="column === 'annotations'" class="d-flex align-center ga-1">
      <v-icon
        :icon="isStarred ? mdiStar : mdiStarOutline"
        :color="isStarred ? 'warning' : undefined"
        size="small"
        class="cursor-pointer"
        @click.stop="emit('star-toggle')"
      />
      <AcmgMenu @select="(c) => emit('acmg-select', c)">
        <template #activator="{ props: menuProps }">
          <v-chip
            v-if="acmgClassification"
            v-bind="menuProps"
            size="x-small"
            :color="ACMG_COLORS[acmgClassification]"
            label
            class="cursor-pointer"
          >
            {{ ACMG_ABBREV[acmgClassification] }}
          </v-chip>
          <v-icon
            v-else
            v-bind="menuProps"
            :icon="mdiTagOutline"
            size="small"
            class="cursor-pointer"
          />
        </template>
      </AcmgMenu>
      <v-icon
        :icon="hasComment ? mdiComment : mdiCommentOutline"
        :color="hasComment ? 'primary' : undefined"
        size="small"
        class="cursor-pointer"
        @click.stop="emit('comment-click')"
      />
    </div>

    <!-- Chromosome -->
    <span v-else-if="column === 'chr'">{{ value }}</span>

    <!-- Gene symbol -->
    <span v-else-if="column === 'gene_symbol'">{{ value }}</span>

    <!-- Position with thousand separators -->
    <span v-else-if="column === 'pos'" class="genomic-coordinate">
      {{ formatPosition(value as number) }}
    </span>

    <!-- Ref allele with truncation and tooltip -->
    <div v-else-if="column === 'ref'">
      <v-tooltip v-if="(value as string).length > 20" location="top">
        <template #activator="{ props: tooltipProps }">
          <span v-bind="tooltipProps" class="text-truncate allele-cell variant-data-mono">
            {{ (value as string).substring(0, 20) }}...
          </span>
        </template>
        <span>{{ value }}</span>
      </v-tooltip>
      <span v-else class="variant-data-mono">{{ value }}</span>
    </div>

    <!-- Alt allele with truncation and tooltip -->
    <div v-else-if="column === 'alt'">
      <v-tooltip v-if="(value as string).length > 20" location="top">
        <template #activator="{ props: tooltipProps }">
          <span v-bind="tooltipProps" class="text-truncate allele-cell variant-data-mono">
            {{ (value as string).substring(0, 20) }}...
          </span>
        </template>
        <span>{{ value }}</span>
      </v-tooltip>
      <span v-else class="variant-data-mono">{{ value }}</span>
    </div>

    <!-- cDNA HGVS notation -->
    <span v-else-if="column === 'cdna'" class="variant-data-mono">
      {{ value ?? '--' }}
    </span>

    <!-- Protein change HGVS notation -->
    <span v-else-if="column === 'aa_change'" class="variant-data-mono">
      {{ value ?? '--' }}
    </span>

    <!-- Impact/Consequence with color coding -->
    <div v-else-if="column === 'consequence'">
      <v-chip v-if="value" :color="getImpactColor(value as string)" size="x-small" label>
        {{ value }}
      </v-chip>
      <span v-else class="text-medium-emphasis">--</span>
    </div>

    <!-- Functional consequence type -->
    <span v-else-if="column === 'func'">
      {{ value ?? '--' }}
    </span>

    <!-- ClinVar with color coding -->
    <div v-else-if="column === 'clinvar'">
      <v-chip v-if="value" :color="clinvarColorToken(value as string)" size="x-small" label>
        {{ clinvarDisplayText(value as string) }}
      </v-chip>
      <span v-else class="text-medium-emphasis">--</span>
    </div>

    <!-- gnomAD allele frequency -->
    <span v-else-if="column === 'gnomad_af'" class="genomic-coordinate">
      <template v-if="value !== null && value !== undefined">
        {{ formatScientific(value as number) }}
      </template>
      <span v-else class="text-medium-emphasis">--</span>
    </span>

    <!-- CADD phred score -->
    <div v-else-if="column === 'cadd_phred'">
      <v-chip
        v-if="value !== null && value !== undefined"
        :color="getCaddColor(value as number)"
        size="x-small"
        label
      >
        {{ (value as number).toFixed(1) }}
      </v-chip>
      <span v-else class="text-medium-emphasis">--</span>
    </div>

    <!-- Carrier count -->
    <div v-else-if="column === 'carrier_count'">
      <v-chip size="x-small" label> {{ item.carrier_count }} / {{ item.total_cases }} </v-chip>
    </div>

    <!-- Cohort frequency as percentage -->
    <span v-else-if="column === 'cohort_frequency'">
      {{ formatPercentage(value as number) }}
    </span>

    <!-- Het / Hom combined column -->
    <span v-else-if="column === 'het_count'" class="text-body-small">
      {{ item.het_count }} het<template v-if="item.hom_count > 0">
        / {{ item.hom_count }} hom</template
      ><span
        v-if="otherZygosityCount(item) > 0"
        title="Hemizygous, or a genotype without a called zygosity"
      >
        / {{ otherZygosityCount(item) }} other</span
      >
    </span>

    <!-- Fallback for unknown columns -->
    <span v-else>{{ value }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * @deprecated This component is no longer used.
 * CohortDataTable.vue now uses shared cell components directly from table-cells/.
 * This file is kept for reference until the next major version.
 * DO NOT modify or extend this component.
 *
 * Migration: Use individual cell components from table-cells/ instead:
 * - AnnotationsCell for star/ACMG/comment controls
 * - PositionCell, AlleleCell, GeneSymbolCell, etc. for data display
 * - ClinVarCell, FrequencyCell, CaddScoreCell for colored chips
 *
 * See CohortDataTable.vue for usage examples.
 */

import type { CohortVariant } from '../../../../shared/types/cohort'
import { otherZygosityCount } from '../../../../shared/utils/genotype'
import type { AcmgClassification } from '../../../../shared/config/domain.config'
import { clinvarColorToken, clinvarDisplayText } from '../../../../shared/config/severity.config'
import AcmgMenu from '../AcmgMenu.vue'
import { ACMG_COLORS, ACMG_ABBREV } from '../../composables/useAnnotations'
import { mdiComment, mdiCommentOutline, mdiStar, mdiStarOutline, mdiTagOutline } from '@mdi/js'

interface Props {
  item: CohortVariant
  column: string
  value?: unknown
  isStarred?: boolean
  acmgClassification?: AcmgClassification | null
  hasComment?: boolean
}

interface Emits {
  (e: 'star-toggle'): void
  (e: 'acmg-select', classification: AcmgClassification | null): void
  (e: 'comment-click'): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()

// Formatting functions
const formatPosition = (pos: number): string => {
  return new Intl.NumberFormat('en-US').format(pos)
}

const formatPercentage = (value: number): string => {
  return `${(value * 100).toFixed(1)}%`
}

const formatScientific = (value: number): string => {
  if (value === 0) return '0'
  if (value >= 0.01) return value.toFixed(4)
  return value.toExponential(1)
}

// Color helper functions matching CohortTable
const getImpactColor = (impact: string): string => {
  switch (impact) {
    case 'HIGH':
      return 'error'
    case 'MODERATE':
      return 'warning'
    case 'LOW':
      return 'info'
    case 'MODIFIER':
      return 'grey'
    default:
      return 'grey'
  }
}

const getCaddColor = (cadd: number): string => {
  if (cadd >= 25) return 'error'
  if (cadd >= 20) return 'orange'
  if (cadd >= 15) return 'warning'
  if (cadd >= 10) return 'info'
  return 'grey'
}
</script>

<style scoped>
.genomic-coordinate {
  font-variant-numeric: tabular-nums;
}

.variant-data-mono {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.85em;
}

.allele-cell {
  display: inline-block;
  max-width: 150px;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
