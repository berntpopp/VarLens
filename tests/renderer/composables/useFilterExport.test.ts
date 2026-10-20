import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { FILTER_DEFAULTS } from '../../../src/shared/filters/filterDefaults'
import type { FilterState } from '../../../src/shared/types/filters'

const exportVariants = vi.fn()
const queryVariants = vi.fn()
const batchGetAnnotations = vi.fn()
const getPerCaseAnnotation = vi.fn()

vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      export: { variants: exportVariants },
      variants: { query: queryVariants },
      annotations: {
        batchGet: batchGetAnnotations,
        getPerCase: getPerCaseAnnotation
      }
    }
  })
}))

vi.mock('../../../src/renderer/src/utils/backend-capabilities', () => ({
  getCurrentUnsupportedReason: async () => null
}))

import { useFilterExport } from '../../../src/renderer/src/composables/useFilterExport'
import {
  formatSignOutTable,
  variantToSignOutRow,
  type SignOutRow
} from '../../../src/renderer/src/utils/sign-out-clipboard'
import type {
  Variant,
  VariantAnnotation,
  CaseVariantAnnotation
} from '../../../src/shared/types/database'
import type { VariantAnnotationsResult } from '../../../src/shared/types/api'

describe('useFilterExport', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    exportVariants.mockReset()
    exportVariants.mockResolvedValue({ success: true, filePath: '/tmp/case.xlsx' })
    queryVariants.mockReset()
    batchGetAnnotations.mockReset()
    getPerCaseAnnotation.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      },
      configurable: true,
      writable: true
    })
  })

  // #485: the exported file must contain exactly the rows the table shows.
  it('exports with the filters of the table query when they are given', async () => {
    const { exportToExcel } = useFilterExport(
      ref({ ...FILTER_DEFAULTS } as FilterState),
      ref([]),
      ref(false)
    )
    const tableFilters = {
      variant_type: 'sv',
      starred_only: true,
      active_panel_ids: [7],
      column_filters: { cadd_phred: { operator: '>=' as const, value: 25 } }
    }

    await exportToExcel(1, 'Case A', undefined, tableFilters)

    expect(exportVariants.mock.calls[0][1]).toEqual(tableFilters)
  })

  it('handles caught error and returns success: false with message (#677)', async () => {
    exportVariants.mockRejectedValue(new Error('Export limited to 100,000 variants.'))

    const { exportToExcel } = useFilterExport(
      ref({ ...FILTER_DEFAULTS } as FilterState),
      ref([]),
      ref(false)
    )

    const res = await exportToExcel(1, 'Case A')
    expect(res).toEqual({ success: false, error: 'Export limited to 100,000 variants.' })
  })

  describe('formatSignOutTable and variantToSignOutRow', () => {
    const row1: SignOutRow = {
      gene: 'BRCA1',
      transcript: 'ENST00000357654',
      hgvs_c: 'c.5266dupC',
      hgvs_p: 'p.Gln1756Profs*74',
      chr_pos_ref_alt: 'chr17:43044295 G>A',
      zygosity: 'het',
      gnomad_af: 0.0001,
      cadd: 28.5,
      acmg: 'Pathogenic (PVS1, PM2)',
      comment: 'Line 1\nLine 2 | with pipe\tand tab'
    }

    it('formats a Markdown table across all 10 columns with header and separator', () => {
      const md = formatSignOutTable([row1], 'markdown')
      const lines = md.split('\n')
      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe(
        '| Gene | Transcript | HGVS c. | HGVS p. | Chr:Pos Ref>Alt | Zygosity | gnomAD AF | CADD | ACMG Classification (Criteria) | Comment |'
      )
      expect(lines[1]).toBe('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
      expect(lines[2]).toBe(
        '| BRCA1 | ENST00000357654 | c.5266dupC | p.Gln1756Profs*74 | chr17:43044295 G>A | het | 0.0001 | 28.5 | Pathogenic (PVS1, PM2) | Line 1 Line 2 \\| with pipe and tab |'
      )
    })

    it('escapes pipe, < (SV/CNV symbolic alleles), newlines, and tabs in Markdown table', () => {
      const svRow: SignOutRow = {
        ...row1,
        chr_pos_ref_alt: 'chr1:1000000 N><DEL>',
        comment: 'Line 1\nLine 2 | with pipe\tand tab'
      }
      const md = formatSignOutTable([svRow], 'markdown')
      expect(md).toContain('chr1:1000000 N>\\<DEL>')
      expect(md).toContain('Line 2 \\| with pipe')
      expect(md).not.toContain('\nLine 2')
      expect(md).not.toContain('\tand')
    })

    it('escapes backslashes so a trailing \\ cannot unescape the cell pipe', () => {
      const md = formatSignOutTable([{ ...row1, comment: 'a\\|b' }], 'markdown')
      expect(md).toContain('a\\\\\\|b')
    })

    it('formats a TSV table across all 10 columns and escapes newlines/tabs', () => {
      const tsv = formatSignOutTable([row1], 'tsv')
      const lines = tsv.split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[0]).toBe(
        'Gene\tTranscript\tHGVS c.\tHGVS p.\tChr:Pos Ref>Alt\tZygosity\tgnomAD AF\tCADD\tACMG Classification (Criteria)\tComment'
      )
      const cols = lines[1].split('\t')
      expect(cols).toHaveLength(10)
      expect(cols[0]).toBe('BRCA1')
      expect(cols[1]).toBe('ENST00000357654')
      expect(cols[2]).toBe('c.5266dupC')
      expect(cols[9]).toBe('Line 1 Line 2 | with pipe and tab')
    })

    it('prioritizes per-case annotations over global annotations in variantToSignOutRow', () => {
      const v: Variant = {
        id: 1,
        chr: '17',
        pos: 43044295,
        ref: 'G',
        alt: 'A',
        gene_symbol: 'BRCA1',
        transcript: 'ENST00000357654',
        cdna: 'c.5266dupC',
        aa_change: 'p.Gln1756Profs*74',
        gt_num: '0/1'
      } as unknown as Variant

      const annot: VariantAnnotationsResult = {
        perCase: {
          id: 10,
          case_id: 1,
          variant_id: 1,
          acmg_classification: 'Pathogenic',
          acmg_evidence: JSON.stringify({
            pathogenic: [
              { code: 'PVS1', confirmed: true },
              { code: 'PM2', confirmed: true }
            ],
            benign: []
          }),
          per_case_comment: 'Case-specific note'
        } as unknown as CaseVariantAnnotation,
        global: {
          id: 20,
          variant_id: 1,
          acmg_classification: 'VUS',
          acmg_evidence: JSON.stringify({ pathogenic: [], benign: [{ code: 'BP4' }] }),
          global_comment: 'Global note'
        } as unknown as VariantAnnotation
      }

      const row = variantToSignOutRow(v, annot)
      expect(row.gene).toBe('BRCA1')
      expect(row.transcript).toBe('ENST00000357654')
      expect(row.hgvs_c).toBe('c.5266dupC')
      expect(row.hgvs_p).toBe('p.Gln1756Profs*74')
      expect(row.chr_pos_ref_alt).toBe('17:43044295 G>A')
      expect(row.zygosity).toBe('het')
      expect(row.acmg).toBe('Pathogenic (PVS1, PM2)')
      expect(row.comment).toBe('Case-specific note')
    })

    it('ignores unconfirmed ACMG criteria and pairs evidence with classification source (#682)', () => {
      const v = {
        id: 1,
        chr: '17',
        pos: 43044295,
        ref: 'G',
        alt: 'A',
        gene_symbol: 'BRCA1',
        gt_num: '0/1'
      } as unknown as Variant

      const annot: VariantAnnotationsResult = {
        perCase: {
          id: 10,
          acmg_classification: 'Likely pathogenic',
          acmg_evidence: JSON.stringify({
            pathogenic: [
              { code: 'PVS1', confirmed: true },
              { code: 'PM2', confirmed: false }
            ],
            benign: []
          }),
          per_case_comment: '   ' // empty whitespace
        } as unknown as CaseVariantAnnotation,
        global: {
          id: 20,
          acmg_classification: 'Benign',
          acmg_evidence: JSON.stringify({
            pathogenic: [],
            benign: [{ code: 'BA1', confirmed: true }]
          }),
          global_comment: 'Global fallback note'
        } as unknown as VariantAnnotation
      }

      const row = variantToSignOutRow(v, annot)
      // Paired ACMG: uses perCase (Likely pathogenic), ignores global benign BA1
      // Confirmed only: PM2 has confirmed: false, so only PVS1 is exported
      expect(row.acmg).toBe('Likely pathogenic (PVS1)')
      // Comment fallback: whitespace perCaseComment falls back to global_comment
      expect(row.comment).toBe('Global fallback note')
    })

    it('escapes formula-leading characters in TSV export (#682)', () => {
      const rows: SignOutRow[] = [
        {
          gene: 'BRCA1',
          transcript: 'ENST1',
          hgvs_c: 'c.1A>G',
          hgvs_p: 'p.M1V',
          chr_pos_ref_alt: '17:100 G>A',
          zygosity: 'het',
          gnomad_af: 0.001,
          cadd: 25,
          acmg: 'Pathogenic',
          comment: '=1+1'
        }
      ]
      const tsv = formatSignOutTable(rows, 'tsv')
      expect(tsv).toContain("\t'=1+1")
    })

    it('formats assumed het zygosity for half-calls (#682)', () => {
      const v = {
        id: 1,
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'T',
        gt_num: '1/.'
      } as unknown as Variant
      expect(variantToSignOutRow(v).zygosity).toBe('assumed het (1/.)')

      const v2 = { ...v, gt_num: './1' }
      expect(variantToSignOutRow(v2).zygosity).toBe('assumed het (./1)')

      const v3 = { ...v, gt_num: '0/1' }
      expect(variantToSignOutRow(v3).zygosity).toBe('het')
    })

    it('formats modified ACMG strengths (e.g. PM2_Supporting, PVS1_Strong) and excludes unconfirmed criteria (#682)', () => {
      const v = {
        id: 1,
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'T'
      } as unknown as Variant

      // Modified strength vs prefix default: PM2 at supporting -> PM2_Supporting, PVS1 at strong -> PVS1_Strong
      const rowModifiedStrength = variantToSignOutRow(v, {
        perCase: {
          acmg_classification: 'Likely pathogenic',
          acmg_evidence: JSON.stringify({
            pathogenic: [
              { code: 'PVS1', strength: 'strong', confirmed: true },
              { code: 'PM1', strength: 'moderate', confirmed: true },
              { code: 'PM2', strength: 'supporting', confirmed: true }
            ],
            benign: []
          })
        } as unknown as CaseVariantAnnotation
      })
      expect(rowModifiedStrength.acmg).toBe('Likely pathogenic (PVS1_Strong, PM1, PM2_Supporting)')

      // Legacy string array inside pathogenic uses getDefaultStrength (PM2 -> supporting -> PM2_Supporting)
      const rowLegacyStrings = variantToSignOutRow(v, {
        perCase: {
          acmg_classification: 'Pathogenic',
          acmg_evidence: JSON.stringify({ pathogenic: ['PVS1', 'PM2'], benign: [] })
        } as unknown as CaseVariantAnnotation
      })
      expect(rowLegacyStrings.acmg).toBe('Pathogenic (PVS1, PM2_Supporting)')

      // Structured AcmgEvidenceState with missing confirmed: true (should be excluded)
      const rowUnconfirmed = variantToSignOutRow(v, {
        perCase: {
          acmg_classification: 'Pathogenic',
          acmg_evidence: JSON.stringify({
            pathogenic: [{ code: 'PVS1', confirmed: true }, { code: 'PP3' }],
            benign: []
          })
        } as unknown as CaseVariantAnnotation
      })
      expect(rowUnconfirmed.acmg).toBe('Pathogenic (PVS1)')
    })
  })

  describe('copySignOutTable', () => {
    const v1: Variant = {
      id: 10,
      chr: '17',
      pos: 43044295,
      ref: 'G',
      alt: 'A',
      gene_symbol: 'BRCA1',
      cdna: 'c.5266dupC',
      aa_change: 'p.Gln1756Profs*74',
      gt_num: '0/1'
    } as unknown as Variant

    const v2: Variant = {
      id: 20,
      chr: '13',
      pos: 32914438,
      ref: 'C',
      alt: 'T',
      gene_symbol: 'BRCA2',
      cdna: 'c.5946delT',
      aa_change: 'p.Ser1982Argfs*22',
      gt_num: '1/1'
    } as unknown as Variant

    it('deduplicates variants appearing in both starred and acmg queries', async () => {
      queryVariants.mockImplementation((_caseId, filter) => {
        if (filter.starred_only) {
          return Promise.resolve({ data: [v1], total_count: 1 })
        }
        return Promise.resolve({ data: [v1, v2], total_count: 2 })
      })
      batchGetAnnotations.mockResolvedValue({
        '17:43044295:G:A': {
          perCase: { acmg_classification: 'Pathogenic' }
        }
      })

      const { copySignOutTable } = useFilterExport(
        ref({ ...FILTER_DEFAULTS } as FilterState),
        ref([]),
        ref(false)
      )

      const result = await copySignOutTable(1, 'markdown')
      expect(result.success).toBe(true)
      expect(result.count).toBe(2)
      expect(queryVariants).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ starred_only: true, annotation_scope: 'all' }),
        0,
        500
      )
      expect(queryVariants).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          acmg_classifications: ['Pathogenic', 'Likely pathogenic'],
          annotation_scope: 'all'
        }),
        0,
        500
      )
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
      const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(written).toContain('BRCA1')
      expect(written).toContain('BRCA2')
      expect(written.split('BRCA1').length - 1).toBe(1)
    })

    it('returns empty result error when no variants are starred or P/LP', async () => {
      queryVariants.mockResolvedValue({ data: [], total_count: 0 })

      const { copySignOutTable } = useFilterExport(
        ref({ ...FILTER_DEFAULTS } as FilterState),
        ref([]),
        ref(false)
      )

      const result = await copySignOutTable(1, 'markdown')
      expect(result.success).toBe(false)
      expect(result.count).toBe(0)
      expect(result.error).toContain('No starred or Pathogenic / Likely pathogenic variants')
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    })

    it('returns error when clipboard API is unavailable (#682)', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {},
        configurable: true,
        writable: true
      })

      const { copySignOutTable } = useFilterExport(
        ref({ ...FILTER_DEFAULTS } as FilterState),
        ref([]),
        ref(false)
      )

      const result = await copySignOutTable(1, 'markdown')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Clipboard API not available')
    })

    it('paginates queries when more than 500 variants exist (#682)', async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => ({
        id: i + 1,
        chr: '1',
        pos: i + 1,
        ref: 'A',
        alt: 'G',
        gene_symbol: `GENE${i + 1}`
      })) as unknown as Variant[]
      const page2 = [{ ...v1, id: 501 }]

      queryVariants.mockImplementation((_caseId, filter, offset) => {
        if (filter.starred_only) {
          if (offset === 0) return Promise.resolve({ data: page1, total_count: 501 })
          return Promise.resolve({ data: page2, total_count: 501 })
        }
        return Promise.resolve({ data: [], total_count: 0 })
      })
      batchGetAnnotations.mockResolvedValue({})

      const { copySignOutTable } = useFilterExport(
        ref({ ...FILTER_DEFAULTS } as FilterState),
        ref([]),
        ref(false)
      )

      const result = await copySignOutTable(1, 'tsv')
      expect(result.success).toBe(true)
      expect(result.count).toBe(501)
      expect(queryVariants).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ starred_only: true }),
        0,
        500
      )
      expect(queryVariants).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ starred_only: true }),
        500,
        500
      )
    })

    it('preserves per-row variant identity for duplicate-coordinate variants (#682)', async () => {
      const dup1: Variant = {
        id: 101,
        chr: '17',
        pos: 43044295,
        ref: 'G',
        alt: 'A',
        gene_symbol: 'BRCA1',
        cdna: 'c.5266dupC',
        transcript: 'NM_007294.4',
        gt_num: '0/1'
      } as unknown as Variant

      const dup2: Variant = {
        id: 102,
        chr: '17',
        pos: 43044295,
        ref: 'G',
        alt: 'A',
        gene_symbol: 'BRCA1',
        cdna: 'c.5266dupC',
        transcript: 'NM_007300.4',
        gt_num: '0/1'
      } as unknown as Variant

      queryVariants.mockImplementation((_caseId, filter) => {
        if (filter.starred_only) {
          return Promise.resolve({ data: [dup1, dup2], total_count: 2 })
        }
        return Promise.resolve({ data: [], total_count: 0 })
      })

      batchGetAnnotations.mockResolvedValue({
        '17:43044295:G:A': {
          global: { acmg_classification: 'VUS', global_comment: 'Global BRCA1 note' },
          perCase: { acmg_classification: 'Pathogenic', per_case_comment: 'First transcript' }
        }
      })

      getPerCaseAnnotation.mockImplementation((_caseId, variantId) => {
        if (variantId === 101) {
          return Promise.resolve({
            id: 1,
            case_id: 1,
            variant_id: 101,
            acmg_classification: 'Pathogenic',
            per_case_comment: 'First transcript note'
          })
        }
        if (variantId === 102) {
          return Promise.resolve({
            id: 2,
            case_id: 1,
            variant_id: 102,
            acmg_classification: 'Likely pathogenic',
            per_case_comment: 'Second transcript note'
          })
        }
        return Promise.resolve(null)
      })

      const { copySignOutTable } = useFilterExport(
        ref({ ...FILTER_DEFAULTS } as FilterState),
        ref([]),
        ref(false)
      )

      const result = await copySignOutTable(1, 'tsv')
      expect(result.success).toBe(true)
      expect(result.count).toBe(2)
      expect(getPerCaseAnnotation).toHaveBeenCalledWith(1, 101)
      expect(getPerCaseAnnotation).toHaveBeenCalledWith(1, 102)

      const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const lines = written.split('\n')
      expect(lines).toHaveLength(3) // header + 2 rows
      expect(lines[1]).toContain('Pathogenic\tFirst transcript note')
      expect(lines[2]).toContain('Likely pathogenic\tSecond transcript note')
    })
  })
})
