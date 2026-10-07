import { describe, expect, it } from 'vitest'
import { baseHeaders as caseHeaders } from '../../../../src/renderer/src/components/variant-table/columns'
import { svHeaders } from '../../../../src/renderer/src/components/variant-table/sv-columns'
import { cnvHeaders } from '../../../../src/renderer/src/components/variant-table/cnv-columns'
import { baseHeaders as cohortHeaders } from '../../../../src/renderer/src/components/cohort/useCohortColumns'
import { findColumn } from '../../../../src/renderer/src/dsl/column-registry'

/**
 * VEP terminology, as clinical users read it: IMPACT is the severity level
 * (HIGH / MODERATE / LOW / MODIFIER, stored in `consequence`) and Consequence
 * is the Sequence Ontology term (missense_variant, …, stored in `func`).
 */
function titleOf(headers: readonly { key: string; title: string }[], key: string): string | null {
  return headers.find((h) => h.key === key)?.title ?? null
}

describe('impact / consequence labels', () => {
  it.each([
    ['case SNV/indel table', caseHeaders],
    ['cohort table', cohortHeaders],
    ['case SV table', svHeaders],
    ['case CNV table', cnvHeaders]
  ])('%s heads the impact-level column "Impact"', (_name, headers) => {
    expect(titleOf(headers, 'consequence')).toBe('Impact')
  })

  it.each([
    ['case SNV/indel table', caseHeaders],
    ['cohort table', cohortHeaders]
  ])('%s heads the SO-term column "Consequence"', (_name, headers) => {
    expect(titleOf(headers, 'func')).toBe('Consequence')
  })

  it('labels the search-bar columns the same way and keeps their keys', () => {
    expect(findColumn('consequence')?.label).toBe('Impact')
    expect(findColumn('func')?.label).toBe('Consequence')
    expect(findColumn('consequence')?.key).toBe('consequence')
    expect(findColumn('func')?.key).toBe('func')
  })
})
