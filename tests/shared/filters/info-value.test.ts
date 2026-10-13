import { describe, it, expect } from 'vitest'
import { readInfoValue, isJsonNumberText } from '../../../src/shared/filters/info-value'

describe('readInfoValue', () => {
  const json = JSON.stringify({
    DP: '35',
    Z: '0',
    E: '1e-5',
    BIG: '1e1000',
    L: '1,2',
    F: '',
    M: '.',
    T: 'abc'
  })

  it('classifies numeric scalars like the SQL emitters', () => {
    expect(readInfoValue(json, 'DP')).toEqual({ present: true, text: '35', num: 35 })
    expect(readInfoValue(json, 'Z').num).toBe(0)
    expect(readInfoValue(json, 'E').num).toBe(1e-5)
    expect(readInfoValue(json, 'BIG').num).toBeNull() // exponent > 3 digits
    expect(readInfoValue(json, 'L').num).toBeNull() // list
    expect(readInfoValue(json, 'T').num).toBeNull()
  })

  it('treats absent and "." as missing, flag "" as present', () => {
    expect(readInfoValue(json, 'NOPE').present).toBe(false)
    expect(readInfoValue(json, 'M').present).toBe(false)
    expect(readInfoValue(json, 'F')).toEqual({ present: true, text: '', num: null })
    expect(readInfoValue(null, 'DP').present).toBe(false)
    expect(readInfoValue('not json', 'DP').present).toBe(false)
    expect(readInfoValue('[1]', 'DP').present).toBe(false)
    expect(readInfoValue('{}', 'constructor').present).toBe(false)
  })

  it('isJsonNumberText', () => {
    for (const ok of ['0', '-1.5', '2E3', ' 7 ']) expect(isJsonNumberText(ok)).toBe(true)
    for (const bad of ['01', '1.', '.5', '1e1234', 'NaN', '', '1,2', `1${'0'.repeat(64)}`]) {
      expect(isJsonNumberText(bad)).toBe(false)
    }
  })
})
