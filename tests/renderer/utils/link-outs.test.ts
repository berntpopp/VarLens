import { describe, expect, it } from 'vitest'
import {
  LINKS_COLUMN_KEY,
  linkAbbreviation,
  linksColumnWidthRem,
  migrateLinkColumnPrefs
} from '../../../src/renderer/src/utils/link-outs'

describe('linkAbbreviation', () => {
  it('uses the curated label for built-in links', () => {
    expect(linkAbbreviation('varsome', 'VarSome')).toBe('VS')
    expect(linkAbbreviation('franklin', 'Franklin')).toBe('Fr')
  })

  it('derives initials or a two-letter prefix for custom links', () => {
    expect(linkAbbreviation('a1', 'My Lab DB')).toBe('ML')
    expect(linkAbbreviation('a2', 'mastermind')).toBe('Ma')
    expect(linkAbbreviation('a3', 'x')).toBe('X')
    expect(linkAbbreviation('a4', '  ')).toBe('?')
  })
})

describe('linksColumnWidthRem', () => {
  it('grows with the number of links and never collapses below one badge', () => {
    expect(linksColumnWidthRem(7)).toBeGreaterThan(linksColumnWidthRem(1))
    expect(linksColumnWidthRem(0)).toBe(linksColumnWidthRem(1))
    // 7 badges stay far narrower than the 7 x 106 px columns they replace
    expect(linksColumnWidthRem(7) * 16).toBeLessThan(260)
  })
})

describe('migrateLinkColumnPrefs', () => {
  const base = { order: [] as string[], visibility: {} as Record<string, boolean>, widths: {} }

  it('returns null when there is nothing to migrate', () => {
    expect(migrateLinkColumnPrefs({ ...base, visibility: { chr: false } })).toBeNull()
  })

  it('hides the Links column only when every saved link column was hidden', () => {
    const allHidden = migrateLinkColumnPrefs({
      ...base,
      visibility: { _link_varsome: false, _link_franklin: false, chr: true }
    })
    expect(allHidden?.visibility).toEqual({ chr: true, [LINKS_COLUMN_KEY]: false })

    const oneShown = migrateLinkColumnPrefs({
      ...base,
      visibility: { _link_varsome: false, _link_franklin: true }
    })
    expect(oneShown?.visibility).toEqual({ [LINKS_COLUMN_KEY]: true })
  })

  it('keeps an existing Links choice', () => {
    const r = migrateLinkColumnPrefs({
      ...base,
      visibility: { _link_varsome: true, [LINKS_COLUMN_KEY]: false }
    })
    expect(r?.visibility).toEqual({ [LINKS_COLUMN_KEY]: false })
  })

  it('puts the Links column where the first saved link column was and drops link widths', () => {
    const r = migrateLinkColumnPrefs({
      order: ['chr', '_link_franklin', 'pos', '_link_varsome'],
      visibility: {},
      widths: { _link_varsome: 90, chr: 70 }
    })
    expect(r?.order).toEqual(['chr', LINKS_COLUMN_KEY, 'pos'])
    expect(r?.widths).toEqual({ chr: 70 })
  })
})
