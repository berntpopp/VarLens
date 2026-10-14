import { describe, expect, it } from 'vitest'
import { HPO_TERM_COPY } from '../../../src/renderer/src/config/hpoTermCopy'
import { groupedHpoTermLines } from '../../../src/renderer/src/utils/hpo-term-status'

describe('groupedHpoTermLines', () => {
  it('names every group from HPO_TERM_COPY', () => {
    const t = (hpo_label: string, excluded: boolean, key: boolean) => ({
      hpo_id: 'HP:1',
      hpo_label,
      excluded,
      key
    })
    expect(
      groupedHpoTermLines([
        t('Seizure', false, true),
        t('Hypotonia', false, false),
        t('Ataxia', true, false)
      ])
    ).toEqual([
      `${HPO_TERM_COPY.keyGroup}: Seizure`,
      `${HPO_TERM_COPY.present}: Hypotonia`,
      `${HPO_TERM_COPY.excluded}: Ataxia`
    ])
  })
})
