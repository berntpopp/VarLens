import { describe, it, expect } from 'vitest'
import { useAcmgEvidence } from '../../../src/renderer/src/composables/useAcmgEvidence'

describe('useAcmgEvidence', () => {
  it('starts with empty state', () => {
    const { pathogenicCodes, benignCodes, effectiveClassification } = useAcmgEvidence()
    expect(pathogenicCodes.value).toEqual([])
    expect(benignCodes.value).toEqual([])
    expect(effectiveClassification.value).toBeNull()
  })

  it('toggleCode adds and removes pathogenic codes', () => {
    const { pathogenicCodes, toggleCode, isCodeActive } = useAcmgEvidence()
    toggleCode('PVS1')
    expect(pathogenicCodes.value).toHaveLength(1)
    expect(isCodeActive('PVS1')).toBe(true)

    toggleCode('PVS1')
    expect(pathogenicCodes.value).toHaveLength(0)
    expect(isCodeActive('PVS1')).toBe(false)
  })

  it('toggleCode adds benign codes to benign list', () => {
    const { benignCodes, toggleCode } = useAcmgEvidence()
    toggleCode('BA1')
    expect(benignCodes.value).toHaveLength(1)
    expect(benignCodes.value[0].code).toBe('BA1')
    expect(benignCodes.value[0].strength).toBe('stand_alone')
  })

  it('calculates classification from toggled codes', () => {
    const { toggleCode, effectiveClassification, classificationResult } = useAcmgEvidence()
    toggleCode('PVS1')
    toggleCode('PM2')
    toggleCode('PP3')
    // PVS1(8) + PM2(1, ClinGen SVI supporting) + PP3(1) = 10
    expect(classificationResult.value.netPoints).toBe(10)
    expect(effectiveClassification.value).toBe('Pathogenic')
  })

  it('override replaces calculated classification', () => {
    const { toggleCode, setOverride, effectiveClassification, isOverride } = useAcmgEvidence()
    toggleCode('PVS1')
    toggleCode('PM2')
    toggleCode('PP3')
    expect(effectiveClassification.value).toBe('Pathogenic')

    setOverride('VUS')
    expect(isOverride.value).toBe(true)
    expect(effectiveClassification.value).toBe('VUS')

    setOverride(null)
    expect(isOverride.value).toBe(false)
    expect(effectiveClassification.value).toBe('Pathogenic')
  })

  it('applySuggestions adds unconfirmed codes', () => {
    const { applySuggestions, isCodeSuggested, isCodeActive } = useAcmgEvidence()
    applySuggestions({ gnomad_af: 0, cadd: 30, clinvar: null })
    expect(isCodeSuggested('PM2')).toBe(true)
    expect(isCodeSuggested('PP3')).toBe(true)
    expect(isCodeActive('PM2')).toBe(false) // not confirmed yet
  })

  it('setCodeStrength changes strength of active code', () => {
    const { toggleCode, setCodeStrength, pathogenicCodes, classificationResult } = useAcmgEvidence()
    toggleCode('PVS1') // default: very_strong (8 pts)
    expect(classificationResult.value.pathogenicPoints).toBe(8)

    setCodeStrength('PVS1', 'moderate') // now 2 pts
    expect(pathogenicCodes.value[0].strength).toBe('moderate')
    expect(classificationResult.value.pathogenicPoints).toBe(2)
  })

  it('confirmSuggestion makes suggested code active', () => {
    const { applySuggestions, confirmSuggestion, isCodeActive, isCodeSuggested } = useAcmgEvidence()
    applySuggestions({ gnomad_af: 0, cadd: null, clinvar: null })
    expect(isCodeSuggested('PM2')).toBe(true)

    confirmSuggestion('PM2')
    expect(isCodeActive('PM2')).toBe(true)
    expect(isCodeSuggested('PM2')).toBe(false)
  })

  it('serialize and loadState round-trip correctly', () => {
    const evidence1 = useAcmgEvidence()
    evidence1.toggleCode('PVS1')
    evidence1.toggleCode('BP4')
    evidence1.notes.value = 'test note'
    const json = evidence1.serialize()

    const evidence2 = useAcmgEvidence()
    evidence2.loadState(json)
    expect(evidence2.isCodeActive('PVS1')).toBe(true)
    expect(evidence2.isCodeActive('BP4')).toBe(true)
    expect(evidence2.notes.value).toBe('test note')
  })

  it('loadState(null) clears auto-suggested codes (variant switch scenario)', () => {
    const { applySuggestions, pathogenicCodes, benignCodes, loadState, isCodeSuggested } =
      useAcmgEvidence()

    // Simulate auto-suggest for variant A
    applySuggestions({ gnomad_af: 0.0001, cadd: 30, clinvar: 'Pathogenic' })
    expect(pathogenicCodes.value.length).toBeGreaterThan(0)

    // Simulate switching to variant B with null evidence
    loadState(null)

    expect(pathogenicCodes.value).toHaveLength(0)
    expect(benignCodes.value).toHaveLength(0)
    expect(isCodeSuggested('PM2')).toBe(false)
    expect(isCodeSuggested('PP3')).toBe(false)
  })

  it('reset clears all state', () => {
    const { toggleCode, notes, reset, pathogenicCodes, effectiveClassification } = useAcmgEvidence()
    toggleCode('PVS1')
    notes.value = 'some note'
    reset()
    expect(pathogenicCodes.value).toEqual([])
    expect(notes.value).toBe('')
    expect(effectiveClassification.value).toBeNull()
  })
})
