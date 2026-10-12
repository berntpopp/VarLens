import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAnnotationDialogs } from '../../../src/renderer/src/composables/useAnnotationDialogs'

const VARIANT = { id: 11, chr: 'chr1', pos: 100, ref: 'A', alt: 'G' }

function setup(saved: boolean) {
  const annotations = {
    upsertGlobalComment: vi.fn(async () => saved),
    upsertPerCaseComment: vi.fn(async () => saved)
  }
  const dialogs = useAnnotationDialogs(ref(1), annotations as never)
  dialogs.openCommentDialog(VARIANT as never)
  return dialogs
}

const CHANGED = {
  globalComment: 'note',
  perCaseComment: 'note',
  globalChanged: true,
  perCaseChanged: true
}

describe('useAnnotationDialogs comment save', () => {
  it('closes the dialog once the comment is saved', async () => {
    const dialogs = setup(true)
    await dialogs.handleCommentSave(CHANGED)
    expect(dialogs.commentDialogOpen.value).toBe(false)
  })

  // #486: closing would discard the typed comment of a write that never landed.
  it('keeps the dialog open when the save failed', async () => {
    const dialogs = setup(false)
    await dialogs.handleCommentSave(CHANGED)
    expect(dialogs.commentDialogOpen.value).toBe(true)
  })
})

describe('useAnnotationDialogs hasAcmgEvidence', () => {
  const EVIDENCE = '{"pathogenic":["PM2","PP3"]}'
  function withEvidence(scope: 'case' | 'all', perCase: string | null, global: string | null) {
    const annotations = {
      getAcmgEvidence: vi.fn(() => perCase),
      getGlobalAcmgEvidence: vi.fn(() => global)
    }
    return useAnnotationDialogs(ref(1), annotations as never, ref(scope))
  }

  it.each([
    ['case', EVIDENCE, null, true],
    ['case', null, EVIDENCE, false],
    ['all', null, EVIDENCE, true],
    ['all', EVIDENCE, null, false],
    ['case', '{"pathogenic":[],"benign":[]}', null, false]
  ] as const)('scope %s (per-case %s, global %s) -> %s', (scope, perCase, global, expected) => {
    expect(withEvidence(scope, perCase, global).hasAcmgEvidence(VARIANT as never)).toBe(expected)
  })
})
