import { describe, expect, it } from 'vitest'

import {
  mergeGlobalAnnotations,
  remapAnnotationGroup,
  type AnnotationRow,
  type KeyUsage
} from '../../../src/shared/genome/annotation-remap'

let nextId = 1
const row = (chr: string, over: Partial<AnnotationRow> = {}): AnnotationRow => ({
  id: nextId++,
  chr,
  pos: 100,
  ref: 'A',
  alt: 'G',
  global_comment: null,
  starred: 0,
  acmg_classification: null,
  acmg_evidence: null,
  created_at: 0,
  updated_at: 1,
  ...over
})
/** Renames by case id: case 1 is GRCh38 (1 → chr1), case 3 is hg19 (chr1 → 1). */
const RENAMES: Record<number, Record<string, string>> = { 1: { '1': 'chr1' }, 3: { chr1: '1' } }
const newName = (caseId: number, chr: string): string => RENAMES[caseId]?.[chr] ?? chr
const use = (caseId: number, chr: string): KeyUsage => ({ caseId, chr })

describe('mergeGlobalAnnotations', () => {
  const row = (over: Partial<Parameters<typeof mergeGlobalAnnotations>[0]>) => ({
    global_comment: null,
    starred: 0,
    acmg_classification: null,
    acmg_evidence: null,
    updated_at: 1,
    ...over
  })

  it('keeps the star, joins the comments and keeps the newer classification', () => {
    expect(
      mergeGlobalAnnotations(
        row({ global_comment: 'a', starred: 1, acmg_classification: 'Benign', updated_at: 1 }),
        row({
          global_comment: 'b',
          acmg_classification: 'Pathogenic',
          acmg_evidence: '{}',
          updated_at: 2
        })
      )
    ).toEqual({
      global_comment: 'a\n\nb',
      starred: 1,
      acmg_classification: 'Pathogenic',
      acmg_evidence: '{}',
      discardedAcmg: 'Benign'
    })
  })

  it('an identical comment appears once; a missing newer classification keeps the older', () => {
    expect(
      mergeGlobalAnnotations(
        row({ global_comment: 'same', acmg_classification: 'Benign', updated_at: 1 }),
        row({ global_comment: 'same ', updated_at: 5 })
      )
    ).toMatchObject({ global_comment: 'same', acmg_classification: 'Benign', discardedAcmg: null })
  })
})

describe('remapAnnotationGroup', () => {
  it('leaves a group alone when no case changes name', () => {
    expect(remapAnnotationGroup([row('chr1')], [use(2, 'chr1')], newName)).toBeNull()
  })

  it('moves a row whose only user is renamed', () => {
    const a = row('1', { global_comment: 'n' })
    expect(remapAnnotationGroup([a], [use(1, '1')], newName)).toEqual({
      deleteIds: [a.id],
      inserts: [expect.objectContaining({ chr: 'chr1', global_comment: 'n' })],
      audits: []
    })
  })

  it('copies a row another case keeps using under the old key', () => {
    const a = row('1', { global_comment: 'n' })
    const out = remapAnnotationGroup([a], [use(1, '1'), use(2, '1')], newName)!
    expect(out.deleteIds).toEqual([])
    expect(out.inserts).toEqual([expect.objectContaining({ chr: 'chr1', global_comment: 'n' })])
  })

  it('a swap keeps each note with its own locus, whatever the order', () => {
    const a = row('1', { global_comment: 'GRCh38' })
    const c = row('chr1', { global_comment: 'hg19' })
    const out = remapAnnotationGroup([c, a], [use(3, 'chr1'), use(1, '1')], newName)!
    expect(out.deleteIds.sort()).toEqual([a.id, c.id].sort())
    expect(out.inserts).toHaveLength(2)
    expect(out.inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chr: 'chr1', global_comment: 'GRCh38' }),
        expect.objectContaining({ chr: '1', global_comment: 'hg19' })
      ])
    )
  })

  it('merges rows that land on one key and reports the dropped classification', () => {
    const a = row('1', { acmg_classification: 'Benign', updated_at: 1, starred: 1 })
    const d = row('chr1', { acmg_classification: 'Pathogenic', updated_at: 2 })
    const out = remapAnnotationGroup([a, d], [use(1, '1'), use(2, 'chr1')], newName)!
    expect(out.inserts).toEqual([
      expect.objectContaining({ chr: 'chr1', starred: 1, acmg_classification: 'Pathogenic' })
    ])
    expect(out.audits).toEqual([
      {
        key: 'chr1:100:A:G',
        discarded: 'Benign',
        kept: 'Pathogenic',
        from: '1:100:A:G, chr1:100:A:G'
      }
    ])
  })
})
