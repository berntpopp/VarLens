import { ref, computed } from 'vue'
import type {
  AcmgEvidenceCode,
  AcmgEvidenceState,
  AcmgCode,
  AcmgClassification,
  EvidenceStrength
} from '../utils/acmg/types'
import { PATHOGENIC_CODES, getDefaultStrength } from '../utils/acmg/types'
import { calculateClassification } from '../utils/acmg/acmg-calculator'
import { generateSuggestions, type VariantAnnotationData } from '../utils/acmg/acmg-suggestions'
import { serializeEvidence, deserializeEvidence } from '../utils/acmg/acmg-serialization'

export function useAcmgEvidence() {
  const pathogenicCodes = ref<AcmgEvidenceCode[]>([])
  const benignCodes = ref<AcmgEvidenceCode[]>([])
  const notes = ref('')
  const isOverride = ref(false)
  const overrideClassification = ref<AcmgClassification | null>(null)
  /** Required while the class overrides the evidence (#567). */
  const overrideReason = ref('')

  const classificationResult = computed(() =>
    calculateClassification(pathogenicCodes.value, benignCodes.value)
  )

  const effectiveClassification = computed(() => {
    if (isOverride.value && overrideClassification.value) {
      return overrideClassification.value
    }
    return classificationResult.value.classification
  })

  function toggleCode(code: AcmgCode): void {
    const isPathogenic = (PATHOGENIC_CODES as readonly string[]).includes(code)
    const list = isPathogenic ? pathogenicCodes : benignCodes
    const index = list.value.findIndex((c) => c.code === code)

    if (index >= 0) {
      list.value.splice(index, 1)
    } else {
      list.value.push({
        code,
        strength: getDefaultStrength(code),
        auto_suggested: false,
        confirmed: true
      })
    }
  }

  function confirmSuggestion(code: AcmgCode): void {
    const isPathogenic = (PATHOGENIC_CODES as readonly string[]).includes(code)
    const list = isPathogenic ? pathogenicCodes : benignCodes
    const item = list.value.find((c) => c.code === code)
    if (item) {
      item.confirmed = true
    }
  }

  function setCodeStrength(code: AcmgCode, strength: EvidenceStrength): void {
    const isPathogenic = (PATHOGENIC_CODES as readonly string[]).includes(code)
    const list = isPathogenic ? pathogenicCodes : benignCodes
    const item = list.value.find((c) => c.code === code)
    if (item) {
      item.strength = strength
    }
  }

  function applySuggestions(data: VariantAnnotationData): void {
    const suggestions = generateSuggestions(data)
    for (const suggestion of suggestions) {
      const isPathogenic = (PATHOGENIC_CODES as readonly string[]).includes(suggestion.code)
      const list = isPathogenic ? pathogenicCodes : benignCodes
      const existing = list.value.find((c) => c.code === suggestion.code)
      if (!existing) {
        list.value.push(suggestion)
      }
    }
  }

  function setOverride(classification: AcmgClassification | null): void {
    if (classification === null) {
      isOverride.value = false
      overrideClassification.value = null
      overrideReason.value = ''
    } else {
      isOverride.value = true
      overrideClassification.value = classification
    }
  }

  function loadState(jsonString: string | null): void {
    const state = deserializeEvidence(jsonString)
    if (state) {
      pathogenicCodes.value = state.pathogenic
      benignCodes.value = state.benign
      notes.value = state.notes
      isOverride.value = state.is_override
      overrideReason.value = state.is_override ? state.override_reason : ''
      if (state.is_override && state.calculated_classification) {
        overrideClassification.value = state.calculated_classification
      } else {
        overrideClassification.value = null
      }
    } else {
      reset()
    }
  }

  function toState(): AcmgEvidenceState {
    return {
      pathogenic: [...pathogenicCodes.value],
      benign: [...benignCodes.value],
      notes: notes.value,
      classification_date: Date.now(),
      calculated_classification: effectiveClassification.value,
      is_override: isOverride.value,
      override_reason: isOverride.value ? overrideReason.value.trim() : ''
    }
  }

  function serialize(): string {
    return serializeEvidence(toState())
  }

  function isCodeActive(code: AcmgCode): boolean {
    const isPathogenic = (PATHOGENIC_CODES as readonly string[]).includes(code)
    const list = isPathogenic ? pathogenicCodes.value : benignCodes.value
    return list.some((c) => c.code === code && c.confirmed)
  }

  function isCodeSuggested(code: AcmgCode): boolean {
    const isPathogenic = (PATHOGENIC_CODES as readonly string[]).includes(code)
    const list = isPathogenic ? pathogenicCodes.value : benignCodes.value
    return list.some((c) => c.code === code && c.auto_suggested && !c.confirmed)
  }

  function reset(): void {
    pathogenicCodes.value = []
    benignCodes.value = []
    notes.value = ''
    isOverride.value = false
    overrideClassification.value = null
    overrideReason.value = ''
  }

  return {
    pathogenicCodes,
    benignCodes,
    notes,
    isOverride,
    overrideClassification,
    overrideReason,
    classificationResult,
    effectiveClassification,
    toggleCode,
    confirmSuggestion,
    setCodeStrength,
    applySuggestions,
    setOverride,
    loadState,
    toState,
    serialize,
    isCodeActive,
    isCodeSuggested,
    reset
  }
}
