<template>
  <Teleport to="body">
    <div v-if="data.visible" class="protein-tooltip" :style="tooltipStyle">
      <!-- Domain tooltip -->
      <template v-if="data.type === 'domain' && data.domain">
        <div class="tooltip-title">{{ data.domain.name }}</div>
        <div class="tooltip-row">
          <span class="tooltip-label">Type:</span>
          <span class="tooltip-value">{{ data.domain.type }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Range:</span>
          <span class="tooltip-value">{{ data.domain.start }}&ndash;{{ data.domain.end }} aa</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">ID:</span>
          <span class="tooltip-value tooltip-mono">{{ data.domain.accession }}</span>
        </div>
      </template>

      <!-- Variant tooltip -->
      <template v-else-if="data.type === 'variant' && data.variants?.length">
        <div class="tooltip-title">
          Position {{ data.variants[0].proteinPosition }}
          <span v-if="data.variants.length > 1" class="tooltip-count">
            ({{ data.variants.length }} variants)
          </span>
        </div>
        <div v-for="(v, i) in displayedVariants" :key="i" class="tooltip-variant">
          <div class="tooltip-row">
            <span class="tooltip-dot" :style="{ backgroundColor: v.color }" />
            <span class="tooltip-value tooltip-mono">{{ v.aaChange ?? 'N/A' }}</span>
          </div>
          <div class="tooltip-row tooltip-sub">
            <span class="tooltip-label">Consequence:</span>
            <span class="tooltip-value">{{ formatConsequence(v.consequence) }}</span>
          </div>
          <div v-if="v.gnomadAf !== null" class="tooltip-row tooltip-sub">
            <span class="tooltip-label">gnomAD AF:</span>
            <span class="tooltip-value tooltip-mono">{{ v.gnomadAf.toExponential(2) }}</span>
          </div>
          <div v-if="v.cadd !== null" class="tooltip-row tooltip-sub">
            <span class="tooltip-label">CADD:</span>
            <span class="tooltip-value tooltip-mono">{{ v.cadd.toFixed(1) }}</span>
          </div>
        </div>
        <div v-if="overflowCount > 0" class="tooltip-overflow">+{{ overflowCount }} more</div>
      </template>

      <!-- ClinVar tooltip -->
      <template v-else-if="data.type === 'clinvar' && data.clinvarGroup">
        <div class="tooltip-title">
          ClinVar
          <span class="tooltip-count">
            ({{ data.clinvarGroup.variants.length }} variant{{
              data.clinvarGroup.variants.length > 1 ? 's' : ''
            }}
            at pos {{ data.clinvarGroup.position }})
          </span>
        </div>
        <div
          v-for="(cv, i) in data.clinvarGroup.variants.slice(0, 5)"
          :key="i"
          class="tooltip-variant"
        >
          <div class="tooltip-row">
            <span class="tooltip-label">ID:</span>
            <span class="tooltip-value tooltip-mono">{{ cv.clinvarVariationId }}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">Significance:</span>
            <span class="tooltip-value">{{ cv.clinicalSignificance }}</span>
          </div>
          <div v-if="cv.goldStars > 0" class="tooltip-row">
            <span class="tooltip-label">Stars:</span>
            <span class="tooltip-value">{{ '\u2605'.repeat(cv.goldStars) }}</span>
          </div>
          <div v-if="cv.hgvsp" class="tooltip-row">
            <span class="tooltip-label">Protein:</span>
            <span class="tooltip-value tooltip-mono">{{ cv.hgvsp }}</span>
          </div>
          <div v-if="cv.alleleFrequency !== null" class="tooltip-row">
            <span class="tooltip-label">AF:</span>
            <span class="tooltip-value tooltip-mono">{{
              cv.alleleFrequency.toExponential(2)
            }}</span>
          </div>
        </div>
        <div v-if="data.clinvarGroup.variants.length > 5" class="tooltip-overflow">
          +{{ data.clinvarGroup.variants.length - 5 }} more
        </div>
      </template>

      <!-- gnomAD tooltip -->
      <template v-else-if="data.type === 'gnomad' && (data.gnomadVariant || data.gnomadGroup)">
        <div class="tooltip-title">
          gnomAD
          <span
            v-if="data.gnomadGroup && data.gnomadGroup.variants.length > 1"
            class="tooltip-count"
          >
            ({{ data.gnomadGroup.variants.length }} variants at pos {{ data.gnomadGroup.position }})
          </span>
        </div>
        <!-- Show first variant details -->
        <template v-if="data.gnomadVariant">
          <div v-if="data.gnomadVariant.hgvsp" class="tooltip-row">
            <span class="tooltip-value tooltip-mono">{{ data.gnomadVariant.hgvsp }}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">Consequence:</span>
            <span class="tooltip-value">{{
              formatConsequence(data.gnomadVariant.consequence)
            }}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">AF:</span>
            <span class="tooltip-value tooltip-mono">{{
              data.gnomadVariant.alleleFrequency.toExponential(2)
            }}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">AC / AN:</span>
            <span class="tooltip-value tooltip-mono">
              {{ data.gnomadVariant.alleleCount }} / {{ data.gnomadVariant.alleleNumber }}
            </span>
          </div>
        </template>
        <!-- Show max AF for groups with multiple variants -->
        <div
          v-if="data.gnomadGroup && data.gnomadGroup.variants.length > 1"
          class="tooltip-row tooltip-sub"
        >
          <span class="tooltip-label">Max AF in group:</span>
          <span class="tooltip-value tooltip-mono">{{
            data.gnomadGroup.maxAf.toExponential(2)
          }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TooltipData } from '../../composables/useLollipopPlot'

const MAX_DISPLAY = 5

interface Props {
  data: TooltipData
}

const props = defineProps<Props>()

const displayedVariants = computed(() => {
  if (!props.data.variants) return []
  return props.data.variants.slice(0, MAX_DISPLAY)
})

const overflowCount = computed(() => {
  if (!props.data.variants) return 0
  return Math.max(0, props.data.variants.length - MAX_DISPLAY)
})

const tooltipStyle = computed(() => {
  const padding = 12
  const maxWidth = 280

  // Position to the right of cursor, flip left if near right edge
  let x = props.data.x + padding
  if (typeof window !== 'undefined' && x + maxWidth > window.innerWidth - padding) {
    x = props.data.x - maxWidth - padding
  }

  // Position below cursor, flip up if near bottom edge
  let y = props.data.y + padding
  if (typeof window !== 'undefined' && y + 200 > window.innerHeight - padding) {
    y = props.data.y - 200
  }

  return {
    left: `${x}px`,
    top: `${y}px`
  }
})

function formatConsequence(consequence: string): string {
  return consequence.replace(/_/g, ' ')
}
</script>

<style scoped>
.protein-tooltip {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 10px 12px;
  min-width: 180px;
  max-width: 280px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  pointer-events: none;
  font-size: 12px;
  line-height: 1.5;
}

.tooltip-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
  color: #333;
}

.tooltip-count {
  font-weight: 400;
  color: #888;
  font-size: 11px;
}

.tooltip-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 1px;
}

.tooltip-sub {
  padding-left: 14px;
}

.tooltip-label {
  color: #888;
  flex-shrink: 0;
}

.tooltip-value {
  color: #333;
}

.tooltip-mono {
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
}

.tooltip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tooltip-variant {
  padding: 3px 0;
  border-bottom: 1px solid #f0f0f0;
}

.tooltip-variant:last-child {
  border-bottom: none;
}

.tooltip-overflow {
  color: #999;
  font-size: 11px;
  margin-top: 4px;
  text-align: center;
}
</style>
