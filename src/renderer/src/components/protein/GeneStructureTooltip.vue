<template>
  <Teleport to="body">
    <div v-if="data.visible" class="gene-structure-tooltip" :style="tooltipStyle">
      <!-- Exon tooltip -->
      <template v-if="data.type === 'exon' && data.exon">
        <div class="tooltip-title">Exon {{ data.exon.rank }}</div>
        <div class="tooltip-row">
          <span class="tooltip-label">Start:</span>
          <span class="tooltip-value tooltip-mono">{{ data.exon.start.toLocaleString() }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">End:</span>
          <span class="tooltip-value tooltip-mono">{{ data.exon.end.toLocaleString() }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Size:</span>
          <span class="tooltip-value tooltip-mono"
            >{{ (data.exon.end - data.exon.start + 1).toLocaleString() }} bp</span
          >
        </div>
      </template>

      <!-- Variant tooltip -->
      <template v-else-if="data.type === 'variant' && data.variantLabel">
        <div class="tooltip-title">Variant</div>
        <div class="tooltip-row">
          <span class="tooltip-value tooltip-mono">{{ data.variantLabel }}</span>
        </div>
      </template>

      <!-- ClinVar variant tooltip -->
      <template v-else-if="data.type === 'clinvar'">
        <div class="tooltip-title">ClinVar Variant</div>
        <div v-if="data.clinvarSignificance" class="tooltip-row">
          <span class="tooltip-label">Significance:</span>
          <span class="tooltip-value">{{ data.clinvarSignificance }}</span>
        </div>
        <div v-if="data.clinvarVariantId" class="tooltip-row">
          <span class="tooltip-label">ID:</span>
          <span class="tooltip-value tooltip-mono">{{ data.clinvarVariantId }}</span>
        </div>
        <div v-if="data.clinvarHgvsp" class="tooltip-row">
          <span class="tooltip-label">Protein:</span>
          <span class="tooltip-value tooltip-mono">{{ data.clinvarHgvsp }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GeneStructureTooltipData } from '../../composables/useGeneStructurePlot'

interface Props {
  data: GeneStructureTooltipData
}

const props = defineProps<Props>()

const tooltipStyle = computed(() => {
  const padding = 12
  const maxWidth = 240

  let x = props.data.x + padding
  if (typeof window !== 'undefined' && x + maxWidth > window.innerWidth - padding) {
    x = props.data.x - maxWidth - padding
  }

  let y = props.data.y + padding
  if (typeof window !== 'undefined' && y + 150 > window.innerHeight - padding) {
    y = props.data.y - 150
  }

  return {
    left: `${x}px`,
    top: `${y}px`
  }
})
</script>

<style scoped>
.gene-structure-tooltip {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 10px 12px;
  min-width: 160px;
  max-width: 240px;
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

.tooltip-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 1px;
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
</style>
