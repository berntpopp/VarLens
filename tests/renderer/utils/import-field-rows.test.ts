/** Rows and edits of the import field-profile table (spec §16). */
import { describe, expect, it } from 'vitest'

import {
  catalogueFields,
  fieldRows,
  mergeIntoDefault,
  vcfPreviewFields,
  withAllKept,
  withFieldChoice
} from '../../../src/renderer/src/utils/import-field-rows'
import {
  DEFAULT_IMPORT_FIELD_PROFILE,
  type ImportFieldProfile
} from '../../../src/shared/config/import-fields.config'
import type { ImportFieldPreview } from '../../../src/shared/types/import'
import type { VcfPreviewResult } from '../../../src/shared/types/vcf'

const field = (name: string, column: string | null = null): ImportFieldPreview => ({
  origin: 'JSON',
  name,
  column,
  type: 'number',
  fillRate: 1,
  samples: []
})
const ALL: ImportFieldProfile = { keepUnknown: 'all', fields: {} }

describe('fieldRows', () => {
  it('locks column fields and shows the key an import writes', () => {
    const rows = fieldRows(
      [field('GnomPMaxFiltAF', 'gnomad_af'), field('RevelScore'), field('AltAF-Index')],
      ALL
    )
    expect(rows.map((r) => [r.name, r.locked, r.key, r.canonical])).toEqual([
      ['GnomPMaxFiltAF', true, null, 'GNOMAD_POPMAX_AF'],
      ['RevelScore', false, 'REVEL', 'REVEL'],
      ['AltAF-Index', false, 'AltAF_Index', null]
    ])
  })
})

describe('profile edits', () => {
  it('drops a choice equal to the default and keeps renames', () => {
    const skipped = withFieldChoice(ALL, field('X'), { keep: false })
    expect(skipped.fields).toEqual({ 'JSON:X': { keep: false } })
    expect(withFieldChoice(skipped, field('X'), { keep: true }).fields).toEqual({})
    expect(withFieldChoice(ALL, field('X'), { keep: true, key: ' MY_X ' }).fields).toEqual({
      'JSON:X': { keep: true, key: 'MY_X' }
    })
  })

  it('keeps or skips every non-column field at once', () => {
    const fields = [field('A'), field('B', 'chr')]
    expect(withAllKept(ALL, fields, false).fields).toEqual({ 'JSON:A': { keep: false } })
  })

  it('merges a file profile into the saved default', () => {
    const merged = mergeIntoDefault(DEFAULT_IMPORT_FIELD_PROFILE, {
      keepUnknown: 'none',
      fields: { 'JSON:A': { keep: true } }
    })
    expect(merged.keepUnknown).toBe('none')
    expect(merged.fields).toMatchObject({
      'JSON:lims_id': { keep: false },
      'JSON:A': { keep: true }
    })
  })
})

describe('field lists', () => {
  it('lists VCF INFO fields before the CSQ subfields', () => {
    const preview = {
      annotationType: 'csq',
      infoFields: [
        { id: 'DP', type: 'Integer', number: '1', description: 'Depth', mapsToColumn: null }
      ],
      annotationFields: ['Allele', 'REVEL_score']
    } as unknown as VcfPreviewResult
    expect(vcfPreviewFields(preview).map((f) => [f.origin, f.name, f.column])).toEqual([
      ['INFO', 'DP', null],
      ['CSQ', 'Allele', 'alt (allele match)'],
      ['CSQ', 'REVEL_score', null]
    ])
  })

  it('offers the evidence aliases, the varvis catalogue and the profile fields', () => {
    const names = catalogueFields({
      keepUnknown: 'all',
      fields: { 'INFO:CUSTOM': { keep: false } }
    }).map((f) => `${f.origin}:${f.name}`)
    expect(names).toContain('JSON:RevelScore')
    expect(names).toContain('CSQ:REVEL_score')
    expect(names).toContain('JSON:LocalAF')
    expect(names).toContain('INFO:CUSTOM')
    expect(new Set(names).size).toBe(names.length)
  })
})
