/**
 * ACMG classification setters with an undo snackbar.
 *
 * Drop-in replacements for the four `useAnnotations` ACMG setters (same
 * signatures; a failed write resolves `false` and offers nothing). Each
 * captures the cached previous state, performs the write,
 * then shows "Classified as …" with an Undo action that restores the exact
 * previous classification (and evidence, when the change carried evidence).
 * Undo uses the raw setters, so undoing never stacks another undo.
 */
import { inject } from 'vue'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import { useAnnotations } from './useAnnotations'
import { AppStateKey } from './useAppState'
import { planAcmgUndo, type AcmgState } from '../utils/acmg/acmg-undo'
import { logService } from '../services/LogService'
import { formatError } from '../utils/ipc-result'

const UNDO_SNACKBAR_MS = 8000

type Locus = [chr: string, pos: number, ref: string, alt: string]

export function useAcmgUndo() {
  const annotations = useAnnotations()
  const appState = inject(AppStateKey, null)

  function offerUndo(previous: AcmgState, next: AcmgState, restore: () => Promise<boolean>): void {
    const plan = planAcmgUndo(previous, next)
    if (plan === null || appState === null) return
    appState.showSnack(plan.message, 'success', {
      timeout: UNDO_SNACKBAR_MS,
      action: {
        text: 'Undo',
        callback: () => {
          restore()
            .then((undone) => {
              // A failed undo was rolled back and reported by useAnnotations.
              if (undone) appState.showSnack('ACMG change undone', 'info')
            })
            .catch((e: unknown) => {
              logService.error('ACMG undo failed: ' + formatError(e), 'acmg')
              appState.showSnack('Could not undo the ACMG change', 'error')
            })
        }
      }
    })
  }

  async function setAcmgClassification(
    caseId: number,
    variantId: number,
    ...rest: [...Locus, AcmgClassification | null]
  ): Promise<boolean> {
    const [chr, pos, ref, alt, classification] = rest
    const previous: AcmgState = {
      classification: annotations.getAcmgClassification(chr, pos, ref, alt)
    }
    // Nothing was saved (rolled back and reported): no success message, no Undo.
    if (
      !(await annotations.setAcmgClassification(
        caseId,
        variantId,
        chr,
        pos,
        ref,
        alt,
        classification
      ))
    )
      return false
    offerUndo(previous, { classification }, () =>
      annotations.setAcmgClassification(
        caseId,
        variantId,
        chr,
        pos,
        ref,
        alt,
        previous.classification
      )
    )
    return true
  }

  async function setGlobalAcmgClassification(
    ...args: [...Locus, AcmgClassification | null]
  ): Promise<boolean> {
    const [chr, pos, ref, alt, classification] = args
    const previous: AcmgState = {
      classification: annotations.getGlobalAcmgClassification(chr, pos, ref, alt)
    }
    // Nothing was saved (rolled back and reported): no success message, no Undo.
    if (!(await annotations.setGlobalAcmgClassification(chr, pos, ref, alt, classification)))
      return false
    offerUndo(previous, { classification }, () =>
      annotations.setGlobalAcmgClassification(chr, pos, ref, alt, previous.classification)
    )
    return true
  }

  async function setAcmgClassificationWithEvidence(
    caseId: number,
    variantId: number,
    ...rest: [...Locus, AcmgClassification | null, string]
  ): Promise<boolean> {
    const [chr, pos, ref, alt, classification, evidenceJson] = rest
    const previous: AcmgState = {
      classification: annotations.getAcmgClassification(chr, pos, ref, alt),
      evidenceJson: annotations.getAcmgEvidence(chr, pos, ref, alt)
    }
    const saved = await annotations.setAcmgClassificationWithEvidence(
      caseId,
      variantId,
      chr,
      pos,
      ref,
      alt,
      classification,
      evidenceJson
    )
    if (!saved) return false
    offerUndo(previous, { classification, evidenceJson }, () =>
      annotations.setAcmgClassificationWithEvidence(
        caseId,
        variantId,
        chr,
        pos,
        ref,
        alt,
        previous.classification,
        previous.evidenceJson ?? ''
      )
    )
    return true
  }

  async function setGlobalAcmgClassificationWithEvidence(
    ...args: [...Locus, AcmgClassification | null, string]
  ): Promise<boolean> {
    const [chr, pos, ref, alt, classification, evidenceJson] = args
    const previous: AcmgState = {
      classification: annotations.getGlobalAcmgClassification(chr, pos, ref, alt),
      evidenceJson: annotations.getGlobalAcmgEvidence(chr, pos, ref, alt)
    }
    const saved = await annotations.setGlobalAcmgClassificationWithEvidence(
      chr,
      pos,
      ref,
      alt,
      classification,
      evidenceJson
    )
    if (!saved) return false
    offerUndo(previous, { classification, evidenceJson }, () =>
      annotations.setGlobalAcmgClassificationWithEvidence(
        chr,
        pos,
        ref,
        alt,
        previous.classification,
        previous.evidenceJson ?? ''
      )
    )
    return true
  }

  return {
    setAcmgClassification,
    setGlobalAcmgClassification,
    setAcmgClassificationWithEvidence,
    setGlobalAcmgClassificationWithEvidence
  }
}
