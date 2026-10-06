import { describe, expect, it } from 'vitest'

import { readableTextOn } from '../../../src/renderer/src/utils/readable-text-color'

describe('readableTextOn', () => {
  it('picks black on light data colours and white on dark ones', () => {
    expect(readableTextOn('#ff8c00')).toBe('#000') // splice orange
    expect(readableTextOn('#91cf60')).toBe('#000') // likely benign green
    expect(readableTextOn('#d73027')).toBe('#fff') // pathogenic red
    expect(readableTextOn('#1a1a1a')).toBe('#fff')
  })

  it('falls back to white for non-hex input', () => {
    expect(readableTextOn('primary')).toBe('#fff')
  })
})
