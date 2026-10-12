import { describe, expect, it, vi } from 'vitest'

import { logService } from '../../../src/renderer/src/services/LogService'
import {
  importDataNotices,
  logUnrankedClinvar,
  unrankedClinvarSummary
} from '../../../src/renderer/src/utils/unranked-clinvar'
import { IMPORT_MESSAGES } from '../../../src/shared/config/import.config'

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

  it('lists the import data warnings: unranked ClinVar values, then gnomAD AF out of range', () => {
    expect(importDataNotices({})).toEqual([])
    expect(importDataNotices({ unrankedClinvar: [], afOutOfRange: 0 })).toEqual([])
    expect(importDataNotices({ afOutOfRange: 1 })).toEqual([IMPORT_MESSAGES.afOutOfRange(1)])
    expect(IMPORT_MESSAGES.afOutOfRange(1)).toMatch(/^1 variant has a gnomAD AF outside 0–1/)
    expect(IMPORT_MESSAGES.afOutOfRange(1200)).toMatch(/^1,200 variants have a gnomAD AF/)
    expect(importDataNotices({ unrankedClinvar: ['odd'], afOutOfRange: 2 })).toEqual([
      unrankedClinvarSummary(['odd']),
      IMPORT_MESSAGES.afOutOfRange(2)
    ])
  })
})
