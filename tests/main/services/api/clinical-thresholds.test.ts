/**
 * Tests for clinical threshold classification functions
 */

import { describe, it, expect } from 'vitest'
import {
  CLINICAL_THRESHOLDS,
  getCADDClassification,
  getREVELClassification,
  getSpliceAIMaxDelta,
  getSpliceAIClassification,
  getGnomADClassification
} from '../../../../src/main/services/api/clinical-thresholds'

describe('Clinical Thresholds', () => {
  describe('CADD Classification', () => {
    it('should classify high CADD scores as pathogenic', () => {
      expect(getCADDClassification(25)).toBe('pathogenic')
      expect(getCADDClassification(20)).toBe('pathogenic')
      expect(getCADDClassification(30)).toBe('pathogenic')
    })

    it('should classify low CADD scores as benign', () => {
      expect(getCADDClassification(5)).toBe('benign')
      expect(getCADDClassification(10)).toBe('benign')
      expect(getCADDClassification(0)).toBe('benign')
    })

    it('should classify intermediate CADD scores as uncertain', () => {
      expect(getCADDClassification(15)).toBe('uncertain')
      expect(getCADDClassification(10.1)).toBe('uncertain')
      expect(getCADDClassification(19.9)).toBe('uncertain')
    })

    it('should handle undefined CADD score', () => {
      expect(getCADDClassification(undefined)).toBe('unknown')
    })
  })

  describe('REVEL Classification', () => {
    it('should classify high REVEL scores as pathogenic', () => {
      expect(getREVELClassification(0.644)).toBe('pathogenic')
      expect(getREVELClassification(0.773)).toBe('pathogenic')
      expect(getREVELClassification(0.932)).toBe('pathogenic')
      expect(getREVELClassification(0.85)).toBe('pathogenic')
    })

    it('should classify low REVEL scores as benign', () => {
      expect(getREVELClassification(0.01)).toBe('benign')
      expect(getREVELClassification(0.183)).toBe('benign')
      expect(getREVELClassification(0.29)).toBe('benign')
    })

    it('should classify intermediate REVEL scores as uncertain', () => {
      expect(getREVELClassification(0.4)).toBe('uncertain')
      expect(getREVELClassification(0.5)).toBe('uncertain')
      expect(getREVELClassification(0.3)).toBe('uncertain')
    })

    it('should handle undefined REVEL score', () => {
      expect(getREVELClassification(undefined)).toBe('unknown')
    })
  })

  describe('SpliceAI Max Delta', () => {
    it('should return maximum of all delta scores', () => {
      const maxDelta = getSpliceAIMaxDelta(0.1, 0.5, 0.3, 0.2)
      expect(maxDelta).toBe(0.5)
    })

    it('should handle missing delta scores', () => {
      const maxDelta = getSpliceAIMaxDelta(0.1, undefined, 0.3, undefined)
      expect(maxDelta).toBe(0.3)
    })

    it('should return undefined when all scores are undefined', () => {
      const maxDelta = getSpliceAIMaxDelta(undefined, undefined, undefined, undefined)
      expect(maxDelta).toBeUndefined()
    })

    it('should handle single delta score', () => {
      const maxDelta = getSpliceAIMaxDelta(0.8, undefined, undefined, undefined)
      expect(maxDelta).toBe(0.8)
    })
  })

  describe('SpliceAI Classification', () => {
    it('should classify high delta scores as pathogenic', () => {
      expect(getSpliceAIClassification(0.2)).toBe('pathogenic')
      expect(getSpliceAIClassification(0.5)).toBe('pathogenic')
      expect(getSpliceAIClassification(0.95)).toBe('pathogenic')
    })

    it('should classify low delta scores as benign', () => {
      expect(getSpliceAIClassification(0.05)).toBe('benign')
      expect(getSpliceAIClassification(0.1)).toBe('benign')
    })

    it('should classify intermediate delta scores as uncertain', () => {
      expect(getSpliceAIClassification(0.15)).toBe('uncertain')
      expect(getSpliceAIClassification(0.11)).toBe('uncertain')
      expect(getSpliceAIClassification(0.19)).toBe('uncertain')
    })

    it('should handle undefined delta score', () => {
      expect(getSpliceAIClassification(undefined)).toBe('unknown')
    })
  })

  describe('gnomAD Frequency Classification', () => {
    it('should classify high frequencies as common', () => {
      expect(getGnomADClassification(0.05)).toBe('common')
      expect(getGnomADClassification(0.1)).toBe('common')
      expect(getGnomADClassification(0.5)).toBe('common')
    })

    it('should classify very low frequencies as veryRare', () => {
      expect(getGnomADClassification(0.0001)).toBe('veryRare')
      expect(getGnomADClassification(0.0009)).toBe('veryRare')
      expect(getGnomADClassification(0.00001)).toBe('veryRare')
    })

    it('should classify low frequencies as rare', () => {
      expect(getGnomADClassification(0.005)).toBe('rare')
      expect(getGnomADClassification(0.001)).toBe('rare')
      expect(getGnomADClassification(0.009)).toBe('rare')
    })

    it('should handle undefined frequency', () => {
      expect(getGnomADClassification(undefined)).toBe('unknown')
    })
  })

  describe('Threshold Constants', () => {
    it('should have correct CADD thresholds', () => {
      expect(CLINICAL_THRESHOLDS.CADD.pathogenic).toBe(20)
      expect(CLINICAL_THRESHOLDS.CADD.uncertain).toBe(10)
      expect(CLINICAL_THRESHOLDS.CADD.benign).toBe(10)
    })

    it('should have correct REVEL thresholds', () => {
      expect(CLINICAL_THRESHOLDS.REVEL.pathogenic.supporting).toBe(0.644)
      expect(CLINICAL_THRESHOLDS.REVEL.pathogenic.moderate).toBe(0.773)
      expect(CLINICAL_THRESHOLDS.REVEL.pathogenic.strong).toBe(0.932)
      expect(CLINICAL_THRESHOLDS.REVEL.benign.supporting).toBe(0.29)
      expect(CLINICAL_THRESHOLDS.REVEL.benign.moderate).toBe(0.183)
      expect(CLINICAL_THRESHOLDS.REVEL.benign.strong).toBe(0.016)
    })

    it('should have correct SpliceAI thresholds', () => {
      expect(CLINICAL_THRESHOLDS.SPLICEAI.pathogenic).toBe(0.2)
      expect(CLINICAL_THRESHOLDS.SPLICEAI.benign).toBe(0.1)
      expect(CLINICAL_THRESHOLDS.SPLICEAI.maxDelta).toBe(0.5)
    })

    it('should have correct gnomAD frequency thresholds', () => {
      expect(CLINICAL_THRESHOLDS.GNOMAD_AF.rare).toBe(0.01)
      expect(CLINICAL_THRESHOLDS.GNOMAD_AF.veryRare).toBe(0.001)
      expect(CLINICAL_THRESHOLDS.GNOMAD_AF.common).toBe(0.05)
    })
  })
})
