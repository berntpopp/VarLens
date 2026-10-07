/**
 * The ACMG classification order (#469 review, item 8): one definition in the
 * shared severity configuration, and every SQL statement that ranks ACMG
 * classes is generated from it.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ACMG_CLASSIFICATIONS } from '../../../src/shared/config/domain.config'
import {
  ACMG_RANKS,
  acmgLabelCaseSql,
  acmgRank,
  acmgRankCaseSql
} from '../../../src/shared/config/severity.config'

const SRC = resolve(__dirname, '../../../src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

describe('ACMG classification ranks', () => {
  it('ranks the five classes, Pathogenic highest, unknown 0', () => {
    expect(ACMG_RANKS).toEqual([
      { label: 'Pathogenic', rank: 5 },
      { label: 'Likely pathogenic', rank: 4 },
      { label: 'Uncertain significance', rank: 3 },
      { label: 'Likely benign', rank: 2 },
      { label: 'Benign', rank: 1 }
    ])
    expect(ACMG_RANKS.map(({ label }) => label)).toEqual([...ACMG_CLASSIFICATIONS])
    expect(acmgRank('Likely pathogenic')).toBe(4)
    expect(acmgRank(null)).toBe(0)
    expect(acmgRank('pathogenic')).toBe(0)
  })

  it('generates the rank and the label CASE', () => {
    expect(acmgRankCaseSql('va.acmg_classification')).toBe(
      "CASE va.acmg_classification WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4 " +
        "WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2 WHEN 'Benign' THEN 1 " +
        'ELSE 0 END'
    )
    expect(acmgLabelCaseSql('MAX(rank)')).toBe(
      "CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic' " +
        "WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign' WHEN 1 THEN 'Benign' " +
        'ELSE NULL END'
    )
  })

  it('is not written out anywhere else in the sources', () => {
    const hardCoded = /WHEN\s+'Pathogenic'\s+THEN\s+5|WHEN\s+5\s+THEN\s+'Pathogenic'/
    const offenders = sourceFiles(SRC).filter((path) => hardCoded.test(readFileSync(path, 'utf8')))
    expect(offenders.map((path) => path.slice(SRC.length + 1))).toEqual([])
  })
})
