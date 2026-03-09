<template>
  <div :class="['criteria-section', `criteria-section--${type}`]" class="mb-3">
    <div class="d-flex align-center justify-space-between mb-1">
      <span class="text-caption font-weight-bold">{{ title }}</span>
      <v-chip size="x-small" variant="tonal" :color="totalPoints > 0 ? chipColor : 'grey'" label>
        {{ pointsPrefix }}{{ totalPoints }} pts
      </v-chip>
    </div>

    <div v-for="group in groups" :key="group.label" class="mb-1">
      <div class="text-caption text-medium-emphasis mb-half strength-label">
        {{ group.label }}
        <span class="text-disabled">({{ group.points }}pt{{ group.points !== 1 ? 's' : '' }})</span>
      </div>
      <div class="criteria-grid">
        <v-tooltip v-for="code in group.codes" :key="code" location="top" :open-delay="300">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              :color="getButtonColor(code)"
              :variant="getButtonVariant(code)"
              size="x-small"
              density="compact"
              :class="[
                'criteria-btn text-caption',
                {
                  'criteria-btn--suggested': isCodeSuggested(code),
                  'criteria-btn--deprecated': isDeprecated(code)
                }
              ]"
              rounded="sm"
              @click="$emit('codeClick', code)"
            >
              {{ code }}
              <v-icon v-if="isCodeSuggested(code)" size="8" class="ml-1"
                >mdi-lightbulb-outline</v-icon
              >
            </v-btn>
          </template>
          <div class="tooltip-content">
            <div class="font-weight-bold">{{ code }}</div>
            <div class="text-caption">{{ CODE_DESCRIPTIONS[code] }}</div>
            <div v-if="isCodeActive(code)" class="text-caption mt-1">
              Strength: {{ getStrengthLabel(getCodeStrength(code)) }} ({{
                getStrengthPoints(getCodeStrength(code))
              }}
              pts)
            </div>
            <div v-if="isDeprecated(code)" class="text-caption mt-1 text-warning">
              Not recommended (ClinGen 2020)
            </div>
            <div v-if="isCodeSuggested(code)" class="text-caption mt-1 font-italic">
              Click to confirm suggestion
            </div>
          </div>
        </v-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AcmgCode, EvidenceStrength, AcmgEvidenceCode } from '../../utils/acmg/types'
import {
  CODE_DESCRIPTIONS,
  STRENGTH_OPTIONS,
  EVIDENCE_POINTS,
  DEPRECATED_CODES
} from '../../utils/acmg/types'
import { getDefaultStrength as getDefaultCodeStrength } from '../../utils/acmg/types'

interface CodeGroup {
  label: string
  points: number
  codes: AcmgCode[]
}

const props = defineProps<{
  title: string
  type: 'pathogenic' | 'benign'
  totalPoints: number
  chipColor: string
  pointsPrefix: string
  groups: CodeGroup[]
  /** All pathogenic + benign evidence codes for looking up state */
  allCodes: AcmgEvidenceCode[]
  /** Function to check if a code is active */
  isCodeActive: (code: AcmgCode) => boolean
  /** Function to check if a code is suggested */
  isCodeSuggested: (code: AcmgCode) => boolean
}>()

defineEmits<{
  codeClick: [code: AcmgCode]
}>()

/** Color per strength level for active code chips/buttons */
const STRENGTH_COLORS: Record<EvidenceStrength, string> = {
  very_strong: 'deep-purple',
  strong: 'orange-darken-2',
  moderate: 'amber-darken-1',
  supporting: 'blue-grey',
  stand_alone: 'red-darken-2'
}

/** Muted color hints for inactive (unselected) buttons by default strength */
const INACTIVE_COLORS: Record<EvidenceStrength, string> = {
  very_strong: 'deep-purple-lighten-5',
  strong: 'orange-lighten-5',
  moderate: 'amber-lighten-5',
  supporting: 'blue-grey-lighten-5',
  stand_alone: 'red-lighten-5'
}

function getCodeStrength(code: AcmgCode): EvidenceStrength {
  const entry = props.allCodes.find((c) => c.code === code)
  return entry?.strength ?? getDefaultCodeStrength(code)
}

function getDefaultStrength(code: AcmgCode): EvidenceStrength {
  return getDefaultCodeStrength(code)
}

function isDeprecated(code: AcmgCode): boolean {
  return DEPRECATED_CODES.has(code)
}

function getButtonColor(code: AcmgCode): string {
  if (props.isCodeActive(code)) return STRENGTH_COLORS[getCodeStrength(code)]
  if (props.isCodeSuggested(code)) return 'amber-darken-2'
  if (isDeprecated(code)) return 'grey-lighten-2'
  return INACTIVE_COLORS[getDefaultStrength(code)]
}

function getButtonVariant(code: AcmgCode): 'flat' | 'outlined' | 'tonal' {
  if (props.isCodeActive(code)) return 'flat'
  if (props.isCodeSuggested(code)) return 'outlined'
  return 'tonal'
}

function getStrengthLabel(strength: EvidenceStrength): string {
  return STRENGTH_OPTIONS.find((o) => o.value === strength)?.label ?? strength
}

function getStrengthPoints(strength: EvidenceStrength): number {
  return EVIDENCE_POINTS[strength]
}
</script>

<style scoped>
.criteria-section {
  border-left: 3px solid transparent;
  padding-left: 8px;
}

.criteria-section--pathogenic {
  border-left-color: rgba(211, 47, 47, 0.3);
}

.criteria-section--benign {
  border-left-color: rgba(56, 142, 60, 0.3);
}

.strength-label {
  font-size: 10px !important;
  line-height: 1.2;
}

.mb-half {
  margin-bottom: 2px;
}

.criteria-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.criteria-btn {
  min-width: 0 !important;
  padding: 2px 8px !important;
  font-size: 11px !important;
  letter-spacing: 0 !important;
  height: 26px !important;
}

.criteria-btn--suggested {
  border-style: dashed !important;
}

.criteria-btn--deprecated {
  opacity: 0.5;
  text-decoration: line-through;
}

.tooltip-content {
  max-width: 280px;
}
</style>
