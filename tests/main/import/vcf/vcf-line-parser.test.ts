import { describe, it, expect } from 'vitest'
import { parseVcfLine } from '../../../../src/main/import/vcf/vcf-line-parser'

const SAMPLE_NAMES = ['HG005', 'HG006', 'HG007']

describe('vcf-line-parser', () => {
  it('parses a simple SNV line', () => {
    const line =
      'chr22\t20000100\trs123456\tA\tG\t99\tPASS\tCSQ=G|missense_variant\tGT:GQ:DP:AD\t0/1:99:45:22,23\t0/0:99:40:40,0\t0/0:99:38:38,0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.chrom).toBe('chr22')
    expect(record.pos).toBe(20000100)
    expect(record.id).toBe('rs123456')
    expect(record.ref).toBe('A')
    expect(record.alt).toEqual(['G'])
    expect(record.qual).toBe(99)
    expect(record.filter).toBe('PASS')
    expect(record.info.get('CSQ')).toBe('G|missense_variant')
    expect(record.format).toEqual(['GT', 'GQ', 'DP', 'AD'])
    expect(record.samples.get('HG005')).toEqual(['0/1', '99', '45', '22,23'])
    expect(record.samples.get('HG006')).toEqual(['0/0', '99', '40', '40,0'])
  })

  it('parses multi-allelic ALT', () => {
    const line =
      'chr22\t20002000\trs456789\tA\tG,T\t95\tPASS\tCSQ=data\tGT:GQ:DP:AD\t0/1:95:50:25,25,0\t0/2:90:48:24,0,24\t0/0:99:44:44,0,0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.alt).toEqual(['G', 'T'])
    expect(record.samples.get('HG006')).toEqual(['0/2', '90', '48', '24,0,24'])
  })

  it('handles missing ID (".")', () => {
    const line =
      'chr22\t20001000\t.\tATCG\tA\t78\tPASS\tCSQ=data\tGT:GQ:DP:AD\t1/1:78:30:0,30\t0/1:72:28:14,14\t0/1:75:32:16,16'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.id).toBeNull()
  })

  it('handles missing QUAL (".")', () => {
    const line = 'chr22\t100\t.\tA\tG\t.\tPASS\t.\tGT\t0/1\t0/0\t0/0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.qual).toBeNull()
  })

  it('handles missing INFO (".")', () => {
    const line = 'chr22\t100\trs1\tA\tG\t99\tPASS\t.\tGT\t0/1\t0/0\t0/0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.info.size).toBe(0)
  })

  it('parses multiple INFO fields', () => {
    const line =
      'chr22\t20004000\trs567890\tT\tC\t88\tPASS\tANN=data;CLINVAR_CLNSIG=Likely_pathogenic;dbNSFP_CADD_phred=26.5\tGT:GQ:DP:AD\t0/1:88:44:22,22\t0/1:82:40:20,20\t0/0:95:46:46,0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.info.get('ANN')).toBe('data')
    expect(record.info.get('CLINVAR_CLNSIG')).toBe('Likely_pathogenic')
    expect(record.info.get('dbNSFP_CADD_phred')).toBe('26.5')
  })

  it('handles FLAG INFO fields (no value)', () => {
    const line = 'chr22\t100\t.\tA\tG\t99\tPASS\tDB;AF=0.5\tGT\t0/1\t0/0\t0/0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.info.get('DB')).toBe('')
    expect(record.info.get('AF')).toBe('0.5')
  })

  it('handles non-PASS filter values', () => {
    const line =
      'chr22\t20003000\t.\tC\tT\t45\tLowQual\tCSQ=data\tGT:GQ:DP:AD\t0/1:15:10:5,5\t0/0:30:12:12,0\t0/0:28:11:11,0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.filter).toBe('LowQual')
  })

  it('handles sites-only VCF (no samples)', () => {
    const line = 'chr22\t100\trs1\tA\tG\t99\tPASS\tAF=0.5'
    const record = parseVcfLine(line, [])

    expect(record.chrom).toBe('chr22')
    expect(record.format).toEqual([])
    expect(record.samples.size).toBe(0)
  })

  it('handles deletion (REF longer than ALT)', () => {
    const line =
      'chr22\t20001000\t.\tATCG\tA\t78\tPASS\tCSQ=data\tGT:GQ:DP:AD\t1/1:78:30:0,30\t0/1:72:28:14,14\t0/1:75:32:16,16'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.ref).toBe('ATCG')
    expect(record.alt).toEqual(['A'])
  })

  it('handles insertion (ALT longer than REF)', () => {
    const line =
      'chr22\t20001500\t.\tG\tGACC\t72\tPASS\tCSQ=data\tGT:GQ:DP:AD\t0/1:72:36:18,18\t0/0:90:42:42,0\t0/0:88:40:40,0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.ref).toBe('G')
    expect(record.alt).toEqual(['GACC'])
  })
})
