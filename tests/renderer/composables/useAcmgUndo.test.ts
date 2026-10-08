import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, provide } from 'vue'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'

const annotations = {
  getAcmgClassification: vi.fn(),
  getGlobalAcmgClassification: vi.fn(),
  getAcmgEvidence: vi.fn(),
  getGlobalAcmgEvidence: vi.fn(),
  setAcmgClassification: vi.fn(async () => true),
  setGlobalAcmgClassification: vi.fn(async () => true),
  setAcmgClassificationWithEvidence: vi.fn(async () => true),
  setGlobalAcmgClassificationWithEvidence: vi.fn(async () => true)
}
vi.mock('../../../src/renderer/src/composables/useAnnotations', () => ({
  useAnnotations: () => annotations
}))

const { useAcmgUndo } = await import('../../../src/renderer/src/composables/useAcmgUndo')

type Snack = [string, string, { action?: { text: string; callback: () => void } }?]

function mountWithSnack(): { acmg: ReturnType<typeof useAcmgUndo>; snacks: Snack[] } {
  const snacks: Snack[] = []
  let acmg!: ReturnType<typeof useAcmgUndo>
  const Child = {
    setup() {
      acmg = useAcmgUndo()
      return () => null
    }
  }
  createApp({
    setup() {
      const state = createAppState()
      state.setSnackbarHandler((m, t, o) => snacks.push([m, t, o as Snack[2]]))
      provide(AppStateKey, state)
      return () => h(Child)
    }
  }).mount(document.createElement('div'))
  return { acmg, snacks }
}

describe('useAcmgUndo', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers Undo after a per-case class pick and restores the previous value', async () => {
    annotations.getAcmgClassification.mockReturnValue('Uncertain significance')
    const { acmg, snacks } = mountWithSnack()

    await acmg.setAcmgClassification(7, 42, 'chr1', 100, 'A', 'G', 'Likely pathogenic')

    expect(annotations.setAcmgClassification).toHaveBeenCalledWith(
      7,
      42,
      'chr1',
      100,
      'A',
      'G',
      'Likely pathogenic'
    )
    const [message, , options] = snacks[0]
    expect(message).toBe('Classified as Likely pathogenic')
    expect(options?.action?.text).toBe('Undo')

    options!.action!.callback()
    await Promise.resolve()
    expect(annotations.setAcmgClassification).toHaveBeenLastCalledWith(
      7,
      42,
      'chr1',
      100,
      'A',
      'G',
      'Uncertain significance'
    )
  })

  it('restores previous evidence when undoing an evidence-backed change', async () => {
    annotations.getGlobalAcmgClassification.mockReturnValue(null)
    annotations.getGlobalAcmgEvidence.mockReturnValue(null)
    const { acmg, snacks } = mountWithSnack()

    await acmg.setGlobalAcmgClassificationWithEvidence(
      'chr2',
      5,
      'C',
      'T',
      'Pathogenic',
      '{"pathogenic":["PVS1","PS1"]}'
    )
    snacks[0][2]!.action!.callback()
    await Promise.resolve()
    expect(annotations.setGlobalAcmgClassificationWithEvidence).toHaveBeenLastCalledWith(
      'chr2',
      5,
      'C',
      'T',
      null,
      ''
    )
  })

  // #486: the write failed and was rolled back; useAnnotations shows the error.
  it('offers no Undo and no success message when the write failed', async () => {
    annotations.getAcmgClassification.mockReturnValue('Uncertain significance')
    annotations.setAcmgClassification.mockResolvedValueOnce(false)
    const { acmg, snacks } = mountWithSnack()

    const saved = await acmg.setAcmgClassification(7, 42, 'chr1', 100, 'A', 'G', 'Pathogenic')

    expect(saved).toBe(false)
    expect(snacks).toHaveLength(0)
  })

  it('shows no snackbar when the classification did not change', async () => {
    annotations.getAcmgClassification.mockReturnValue('Benign')
    const { acmg, snacks } = mountWithSnack()
    await acmg.setAcmgClassification(1, 2, 'chrX', 9, 'G', 'A', 'Benign')
    expect(snacks).toHaveLength(0)
  })
})
