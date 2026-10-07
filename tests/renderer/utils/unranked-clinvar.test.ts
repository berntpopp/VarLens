import { describe, expect, it, vi } from 'vitest'

import { logService } from '../../../src/renderer/src/services/LogService'
import {
  logUnrankedClinvar,
  unrankedClinvarSummary
} from '../../../src/renderer/src/utils/unranked-clinvar'

describe('unranked ClinVar report in the renderer (#469)', () => {
  it('summarises one value in the singular, displayed like a table cell', () => {
    expect(unrankedClinvarSummary(['totally_made_up_term'])).toBe(
      '1 ClinVar value not recognised, shown as imported but ranked as unknown for sorting and ' +
        'filtering: totally made up term'
    )
  })

  it('writes one warning per file with unknown values to the in-app log', () => {
    const warn = vi.spyOn(logService, 'warn').mockImplementation(() => undefined)
    try {
      logUnrankedClinvar([
        { caseName: 'sevA', unrankedClinvar: ['totally_made_up_term'] },
        { caseName: 'fine' },
        { caseName: 'empty', unrankedClinvar: [] }
      ])
      expect(warn.mock.calls).toEqual([
        [
          expect.stringMatching(
            /^Import "sevA": 1 ClinVar value not recognised.*totally made up term$/
          ),
          'import'
        ]
      ])
    } finally {
      warn.mockRestore()
    }
  })
})
