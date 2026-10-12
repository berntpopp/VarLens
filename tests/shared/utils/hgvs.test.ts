import { describe, it, expect } from 'vitest'
import { decodeVepHgvs } from '../../../src/shared/utils/hgvs'
import { VEP_CSQ_ESCAPES } from '../../../src/shared/config/vep.config'

describe('decodeVepHgvs', () => {
  it.each(VEP_CSQ_ESCAPES.map(({ encoded, decoded }) => [encoded.source, decoded]))(
    'decodes %s to %s',
    (encoded, decoded) => {
      expect(decodeVepHgvs(`ENSP1.1:p.[Val74${encoded}${encoded.toLowerCase()}]`)).toBe(
        `ENSP1.1:p.[Val74${decoded}${decoded}]`
      )
    }
  )

  it('decodes a real VEP HGVSp value and passes null through', () => {
    expect(decodeVepHgvs('ENSP00000355.8:p.Val74%3D')).toBe('ENSP00000355.8:p.Val74=')
    expect(decodeVepHgvs(null)).toBeNull()
  })
})
