/**
 * Integration tests for SV/CNV/STR VCF import pipeline with BED filtering.
 *
 * Exercises the full pipeline: header parsing -> caller detection ->
 * line parsing -> mapping with variant type detection -> extension field extraction.
 * No database required -- tests use VCF parsing functions directly.
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import { readFileSync } from 'fs'
import { parseVcfHeaderFromLines } from '../../../../src/main/import/vcf/vcf-header-parser'
import { mapVcfRecord } from '../../../../src/main/import/vcf/VcfMapper'
import { parseVcfLine } from '../../../../src/main/import/vcf/vcf-line-parser'
import { detectCaller } from '../../../../src/main/import/vcf/caller-detector'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../../../../src/main/import/vcf/info-field-registry'
import { BedFilter } from '../../../../src/main/import/vcf/bed-filter'

const SV_VCF = path.join(__dirname, '../../../test-data/vcf/synthetic-sv.vcf')
const CNV_VCF = path.join(__dirname, '../../../test-data/vcf/synthetic-cnv.vcf')
const STR_VCF = path.join(__dirname, '../../../test-data/vcf/synthetic-str.vcf')
const BED_FILE = path.join(__dirname, '../../../test-data/vcf/test-regions.bed')
// Regression fixtures — see "Genotype no-call bypass for structural variants"
// describe block at the bottom of this file.
const CNV_NOCALL_VCF = path.join(__dirname, '../../../test-data/vcf/synthetic-cnv-nocall.vcf')
const SV_NOCALL_VCF = path.join(
  __dirname,
  '../../../test-data/vcf/synthetic-sniffles-ins-nocall.vcf'
)

function parseVcfFile(filePath: string) {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const headerLines = lines.filter((l) => l.startsWith('#'))
  const dataLines = lines.filter((l) => !l.startsWith('#') && l.trim() !== '')
  const header = parseVcfHeaderFromLines(headerLines)
  const callerInfo = detectCaller(headerLines)
  const callerName = callerInfo.name !== 'unknown' ? callerInfo.name : null
  const sampleName = header.samples[0]

  const variants = []
  for (const line of dataLines) {
    const record = parseVcfLine(line, header.samples)
    if (record === null) continue
    const mapped = mapVcfRecord(record, header, sampleName, DEFAULT_INFO_FIELD_MAPPINGS, callerName)
    variants.push(...mapped)
  }
  return { header, callerInfo, variants }
}

describe('SV VCF import (Sniffles2)', () => {
  it('detects Sniffles2 caller', () => {
    const { callerInfo } = parseVcfFile(SV_VCF)
    expect(callerInfo.name).toBe('Sniffles2')
    expect(callerInfo.version).toBe('2.6.3')
  })

  it('parses all 5 data lines into variants', () => {
    const { variants } = parseVcfFile(SV_VCF)
    // 5 data lines: DEL, INS, DUP, INV, BND
    expect(variants.length).toBe(5)
  })

  it('classifies all SVTYPE variants as sv (including INS with sequence ALT)', () => {
    const { variants } = parseVcfFile(SV_VCF)
    // DEL (<DEL>), DUP (<DUP>), INV (<INV>) use symbolic ALT -> sv
    // BND uses breakend notation -> sv
    // INS has sequence ALT but SVTYPE=INS -> sv (real Sniffles2 insertions
    // emit sequence ALTs rather than <INS>, so we trust SVTYPE over ALT format)
    const svVariants = variants.filter((v) => v.variant_type === 'sv')
    expect(svVariants.length).toBe(5)

    const indelVariants = variants.filter((v) => v.variant_type === 'indel')
    expect(indelVariants.length).toBe(0)

    // Verify the INS record is present in sv variants
    const insVariant = svVariants.find((v) => v.sv_type === 'INS')
    expect(insVariant).toBeDefined()
  })

  it('extracts SV extension fields for DEL', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const del = variants.find((v) => v.sv_type === 'DEL')
    expect(del).toBeDefined()
    expect(del!._sv).toBeDefined()
    expect(del!._sv!.support).toBe(15)
    expect(del!._sv!.dr).toBe(5)
    expect(del!._sv!.dv).toBe(15)
    expect(del!._sv!.sv_is_precise).toBe(1)
    expect(del!._sv!.vaf).toBeCloseTo(0.75)
  })

  it('extracts end_pos and sv_length', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const del = variants.find((v) => v.sv_type === 'DEL')
    expect(del!.end_pos).toBe(1005000)
    expect(del!.sv_length).toBe(-5000)
  })

  it('parses ANN annotations on SVs', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const del = variants.find((v) => v.sv_type === 'DEL')
    expect(del!.gene_symbol).toBe('GENE1')
  })

  it('detects BND from breakend notation', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const bnd = variants.find((v) => v.sv_type === 'BND')
    expect(bnd).toBeDefined()
    expect(bnd!.variant_type).toBe('sv')
  })

  it('attaches _sv extension only to sv-typed variants', () => {
    const { variants } = parseVcfFile(SV_VCF)
    for (const v of variants) {
      if (v.variant_type === 'sv') {
        expect(v._sv).toBeDefined()
      } else {
        expect(v._sv).toBeUndefined()
      }
    }
  })

  it('extracts IMPRECISE flag correctly', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const dup = variants.find((v) => v.sv_type === 'DUP')
    expect(dup!._sv!.sv_is_precise).toBe(0) // IMPRECISE flag set
  })
})

describe('CNV VCF import (Spectre)', () => {
  it('detects Spectre caller', () => {
    const { callerInfo } = parseVcfFile(CNV_VCF)
    expect(callerInfo.name).toBe('Spectre')
  })

  it('classifies all variants as cnv', () => {
    const { variants } = parseVcfFile(CNV_VCF)
    expect(variants.length).toBe(3)
    for (const v of variants) {
      expect(v.variant_type).toBe('cnv')
    }
  })

  it('extracts CNV extension fields', () => {
    const { variants } = parseVcfFile(CNV_VCF)
    const del = variants.find((v) => v.sv_type === 'DEL' && v.pos === 5000000)
    expect(del).toBeDefined()
    expect(del!._cnv).toBeDefined()
    expect(del!._cnv!.copy_number).toBe(1)
    expect(del!._cnv!.homozygosity_ref).toBeCloseTo(0.45)
    expect(del!._cnv!.homozygosity_alt).toBeCloseTo(0.55)
  })

  it('extracts ClinVar from SnpSift annotation', () => {
    const { variants } = parseVcfFile(CNV_VCF)
    const pathogenic = variants.find((v) => v.clinvar !== null && v.clinvar !== undefined)
    expect(pathogenic).toBeDefined()
    expect(pathogenic!.clinvar).toContain('Pathogenic')
  })

  it('attaches _cnv extension to all cnv variants', () => {
    const { variants } = parseVcfFile(CNV_VCF)
    for (const v of variants) {
      expect(v._cnv).toBeDefined()
    }
  })

  it('extracts end_pos and sv_length for CNVs', () => {
    const { variants } = parseVcfFile(CNV_VCF)
    const del = variants.find((v) => v.pos === 5000000)
    expect(del!.end_pos).toBe(5500000)
    expect(del!.sv_length).toBe(500000)
  })
})

describe('STR VCF import (Straglr)', () => {
  it('detects Straglr caller', () => {
    const { callerInfo } = parseVcfFile(STR_VCF)
    expect(callerInfo.name).toBe('Straglr')
  })

  it('classifies variants as str', () => {
    const { variants } = parseVcfFile(STR_VCF)
    for (const v of variants) {
      expect(v.variant_type).toBe('str')
    }
  })

  it('splits multi-allelic STR into separate records', () => {
    const { variants } = parseVcfFile(STR_VCF)
    // ATXN3 has <STR24>,<STR15> -> 2 records after splitting
    // CSTB has <STR50> -> 1 record
    // NOTCH2NLC has <STR17> -> 1 record
    // Total: 4 variants
    expect(variants.length).toBe(4)

    const atxn3Variants = variants.filter(
      (v) => v._str !== undefined && v._str.repeat_id === 'ATXN3'
    )
    expect(atxn3Variants.length).toBe(2)
  })

  it('extracts STR extension fields for ATXN3', () => {
    const { variants } = parseVcfFile(STR_VCF)
    const atxn3 = variants.find((v) => v._str !== undefined && v._str.repeat_id === 'ATXN3')
    expect(atxn3).toBeDefined()
    expect(atxn3!._str!.repeat_unit).toBe('CTG')
    expect(atxn3!._str!.disease).toBe('MJD')
    expect(atxn3!._str!.inheritance_mode).toBe('AD')
    expect(atxn3!._str!.normal_max).toBe(44)
    expect(atxn3!._str!.pathologic_min).toBe(60)
  })

  it('handles full_mutation status', () => {
    const { variants } = parseVcfFile(STR_VCF)
    const cstb = variants.find((v) => v._str !== undefined && v._str.repeat_id === 'CSTB')
    expect(cstb).toBeDefined()
    expect(cstb!._str!.str_status).toBe('full_mutation')
  })

  it('splits Number=A STR_STATUS per allele', () => {
    const { variants } = parseVcfFile(STR_VCF)
    // ATXN3 has STR_STATUS=normal,normal (Number=A) split into per-allele values
    const atxn3Variants = variants.filter(
      (v) => v._str !== undefined && v._str.repeat_id === 'ATXN3'
    )
    for (const v of atxn3Variants) {
      expect(v._str!.str_status).toBe('normal')
    }
  })

  it('preserves FILTER field on LowDepth variants', () => {
    const { variants } = parseVcfFile(STR_VCF)
    const notch2nlc = variants.find((v) => v._str !== undefined && v._str.repeat_id === 'NOTCH2NLC')
    expect(notch2nlc).toBeDefined()
    expect(notch2nlc!.filter).toBe('LowDepth')
  })
})

describe('BED filter integration', () => {
  it('filters SV variants by BED region', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const bedFilter = BedFilter.fromFile(BED_FILE, 0)

    const filtered = variants.filter((v) => {
      if (v.end_pos !== null && v.end_pos !== undefined) {
        return bedFilter.containsRange(v.chr, v.pos, v.end_pos)
      }
      return bedFilter.contains(v.chr, v.pos)
    })

    // chr1:1000000 DEL (end 1005000) overlaps chr1:999001-1010000 (1-based) -> yes
    // chr22:29000000 DUP (end 29020000) overlaps chr22:29000001-29100000 -> yes
    // chr1:2000000 INS (end 2000000) - outside BED regions -> no
    // chr2:5000000 INV (end 5008000) - no chr2 BED regions -> no
    // chr1:9000000 BND - no END, uses point query, outside BED -> no
    expect(filtered.length).toBe(2)
  })

  it('filters CNV variants by BED region', () => {
    const { variants } = parseVcfFile(CNV_VCF)
    const bedFilter = BedFilter.fromFile(BED_FILE, 0)

    const filtered = variants.filter((v) => {
      if (v.end_pos !== null && v.end_pos !== undefined) {
        return bedFilter.containsRange(v.chr, v.pos, v.end_pos)
      }
      return bedFilter.contains(v.chr, v.pos)
    })

    // chr1:5000000 DEL (end 5500000) overlaps chr1:5000001-5600000 -> yes
    // chr22:29500000 DEL (end 29600000) overlaps chr22:29400001-29700000 -> yes
    // chr1:10000000 DUP (end 10200000) - outside BED -> no
    expect(filtered.length).toBe(2)
  })

  it('applies padding to expand BED regions', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const bedFilter = BedFilter.fromFile(BED_FILE, 1000000) // 1M padding

    const filtered = variants.filter((v) => {
      if (v.end_pos !== null && v.end_pos !== undefined) {
        return bedFilter.containsRange(v.chr, v.pos, v.end_pos)
      }
      return bedFilter.contains(v.chr, v.pos)
    })

    // With 1M padding:
    //   chr1:999000-1010000 -> [1, 2010000] (1-based with padding)
    //   chr1:5000000-5600000 -> [4000001, 6600000]
    //   chr22:29000000-29100000 -> [28000001, 30100000]
    //   chr22:29400000-29700000 -> [28400001, 30700000]
    // chr22 intervals merge to [28000001, 30700000]
    //
    // DEL chr1:1000000-1005000 vs [1, 2010000] -> yes
    // INS chr1:2000000-2000000 vs [1, 2010000] -> yes (now included)
    // DUP chr22:29000000-29020000 vs [28000001, 30700000] -> yes
    // INV chr2:5000000-5008000 -> no chr2 -> no
    // BND chr1:9000000 (no END) -> contains(chr1, 9000000) -> no (not in [1,2010000] or [4000001,6600000])
    expect(filtered.length).toBeGreaterThanOrEqual(3)
  })

  it('empty BED filter passes all variants through', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const emptyFilter = BedFilter.empty()

    const filtered = variants.filter((v) => {
      if (v.end_pos !== null && v.end_pos !== undefined) {
        return emptyFilter.containsRange(v.chr, v.pos, v.end_pos)
      }
      return emptyFilter.contains(v.chr, v.pos)
    })

    expect(filtered.length).toBe(variants.length)
  })
})

/**
 * Regression tests for structural-variant genotype-skip bypass.
 *
 * VarLens normally skips variant records whose selected sample GT is no-call
 * (e.g. `./.`) because it indicates the sample doesn't actually carry the ALT
 * allele. But structural-variant callers (Spectre for CNVs, Sniffles2 for
 * insertions) legitimately emit `GT=./.` on variants they ARE reporting —
 * the finding is encoded in caller-specific fields (CN, SUPPORT, VAF) rather
 * than a diploid genotype.
 *
 * Two real-world bugs we fixed:
 *   1. Spectre CNV VCFs with `GT=./.` + `<DEL>`/`<DUP>` symbolic ALTs were
 *      silently dropped during import, producing 0-variant imports for the
 *      entire CNV callset. Fixed by bypassing shouldSkipGenotype when the
 *      ALT is symbolic.
 *   2. Sniffles2 INS records use sequence ALTs (not symbolic `<INS>`) but
 *      still declare `SVTYPE=INS`. With `GT=./.` they hit the skip filter
 *      because `alt.startsWith('<')` returned false. Fixed by ALSO bypassing
 *      when the record has any SVTYPE or breakend notation.
 *
 * These tests lock in both bypasses so the bugs cannot silently regress.
 */
describe('Structural variant GT=./. bypass (regression #94)', () => {
  it('keeps Spectre <DEL>/<DUP> CNVs with GT=./. no-call genotype', () => {
    const { variants } = parseVcfFile(CNV_NOCALL_VCF)
    expect(variants.length).toBe(2)
    for (const v of variants) {
      expect(v.variant_type).toBe('cnv')
      expect(v.gt_num).toBe('./.')
      expect(v._cnv).toBeDefined()
    }
    const del = variants.find((v) => v.sv_type === 'DEL')
    expect(del).toBeDefined()
    expect(del!._cnv!.copy_number).toBe(1)
  })

  it('keeps Sniffles2 sequence-ALT INS with SVTYPE=INS and GT=./. no-call', () => {
    const { variants } = parseVcfFile(SV_NOCALL_VCF)
    expect(variants.length).toBe(1)
    const ins = variants[0]
    expect(ins.variant_type).toBe('sv')
    expect(ins.sv_type).toBe('INS')
    expect(ins.gt_num).toBe('./.')
    // Sequence ALT, not symbolic — confirms the bypass depends on SVTYPE, not `<…>`
    expect(ins.alt.startsWith('<')).toBe(false)
    expect(ins._sv).toBeDefined()
  })
})
