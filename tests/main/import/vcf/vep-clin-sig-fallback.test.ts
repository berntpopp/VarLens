import { describe, it, expect } from 'vitest'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { mapVcfRecord } from '../../../../src/main/import/vcf/VcfMapper'
import { parseVcfHeaderFromLines } from '../../../../src/main/import/vcf/vcf-header-parser'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../../../../src/main/import/vcf/info-field-registry'
import {
  isVepClinSigAlleleSpecific,
  normalizeVepClinSig
} from '../../../../src/main/import/vcf/vep-clin-sig'
import { createObjectFormatMapper } from '../../../../src/main/import/transforms/ObjectFormatMapper'
import type { VcfHeader, VcfRawRecord } from '../../../../src/main/import/vcf/types'

const VEP_115 =
  '##VEP="v115.2" API="v115" cache="/opt/vep/.vep/homo_sapiens/115_GRCh38" ClinVar="202502"'
const CMD_DEFAULT = "##VEP-command-line='vep --cache --everything --pick --vcf'"

interface HeaderOptions {
  vep?: string | null
  commandLine?: string | null
  csqFormat?: string
  extraLines?: string[]
}

function makeHeader(options: HeaderOptions = {}): VcfHeader {
  const csqFormat = options.csqFormat ?? 'Allele|Consequence|IMPACT|SYMBOL|Feature|CLIN_SIG'
  const vep = options.vep === undefined ? VEP_115 : options.vep
  const commandLine = options.commandLine === undefined ? CMD_DEFAULT : options.commandLine
  const lines = [
    '##fileformat=VCFv4.2',
    ...(vep === null ? [] : [vep]),
    `##INFO=<ID=CSQ,Number=.,Type=String,Description="Consequence annotations from Ensembl VEP. Format: ${csqFormat}">`,
    ...(options.extraLines ?? []),
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    ...(commandLine === null ? [] : [commandLine]),
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1'
  ]
  return parseVcfHeaderFromLines(lines)
}

function makeRecord(
  info: Array<[string, string]>,
  alt: string[] = ['G'],
  gt = '0/1'
): VcfRawRecord {
  return {
    chrom: 'chr22',
    pos: 29000100,
    id: '.',
    ref: 'A',
    alt,
    qual: 99,
    filter: 'PASS',
    info: new Map(info),
    format: ['GT'],
    samples: new Map([['S1', [gt]]])
  }
}

function clinvarOf(header: VcfHeader, record: VcfRawRecord): Array<string | null> {
  return mapVcfRecord(record, header, 'S1', DEFAULT_INFO_FIELD_MAPPINGS).map((v) => v.clinvar)
}

const csq = (clinSig: string, allele = 'G'): string =>
  `${allele}|missense_variant|MODERATE|CHEK2|ENST00000404276|${clinSig}`

describe('VEP CLIN_SIG as fallback source for clinvar', () => {
  it('uses CSQ CLIN_SIG when no ClinVar_CLNSIG / INFO CLNSIG is present', () => {
    const header = makeHeader()
    expect(clinvarOf(header, makeRecord([['CSQ', csq('likely_pathogenic')]]))).toEqual([
      'Likely_pathogenic'
    ])
  })

  it('normalises multi-valued &-joined values to the ClinVar CLNSIG spelling', () => {
    const header = makeHeader()
    expect(clinvarOf(header, makeRecord([['CSQ', csq('benign&benign/likely_benign')]]))).toEqual([
      'Benign|Benign/Likely_benign'
    ])
    expect(
      clinvarOf(header, makeRecord([['CSQ', csq('pathogenic&drug_response&pathogenic')]]))
    ).toEqual(['Pathogenic|drug_response'])
  })

  it('leaves clinvar empty when CLIN_SIG is empty', () => {
    expect(clinvarOf(makeHeader(), makeRecord([['CSQ', csq('')]]))).toEqual([null])
  })

  it('never overrides the ClinVar_CLNSIG custom annotation', () => {
    const header = makeHeader({
      csqFormat: 'Allele|Consequence|IMPACT|SYMBOL|Feature|CLIN_SIG|ClinVar_CLNSIG'
    })
    const record = makeRecord([['CSQ', `${csq('benign')}|Pathogenic`]])
    expect(clinvarOf(header, record)).toEqual(['Pathogenic'])
  })

  it('never overrides INFO CLNSIG', () => {
    const header = makeHeader({
      extraLines: ['##INFO=<ID=CLNSIG,Number=.,Type=String,Description="ClinVar significance">']
    })
    const record = makeRecord([
      ['CSQ', csq('benign')],
      ['CLNSIG', 'Likely_pathogenic']
    ])
    expect(clinvarOf(header, record)).toEqual(['Likely_pathogenic'])
  })

  it('keeps the value on the allele VEP annotated it for', () => {
    const header = makeHeader()
    const record = makeRecord(
      [['CSQ', `${csq('pathogenic', 'G')},${csq('', 'T')}`]],
      ['G', 'T'],
      '1/2'
    )
    expect(clinvarOf(header, record)).toEqual(['Pathogenic', null])
  })

  describe('is not imported when allele specificity cannot be established', () => {
    const record = makeRecord([['CSQ', csq('pathogenic')]])

    it.each([
      ['--clin_sig_allele 0', "##VEP-command-line='vep --cache --clin_sig_allele 0 --vcf'"],
      ['--clin_sig_allele=0', "##VEP-command-line='vep --cache --clin_sig_allele=0 --vcf'"],
      ['--no_check_alleles', "##VEP-command-line='vep --cache --no_check_alleles --vcf'"]
    ])('command line has %s', (_label, commandLine) => {
      const header = makeHeader({ commandLine })
      expect(isVepClinSigAlleleSpecific(header)).toBe(false)
      expect(clinvarOf(header, record)).toEqual([null])
    })

    it.each([
      ['VEP release before 98', '##VEP="v97" API="v97" cache="/c/homo_sapiens/97_GRCh38"'],
      ['cache older than release 98', '##VEP="v110" API="v110" cache="/c/homo_sapiens/96_GRCh37"'],
      ['unparseable ##VEP line', '##VEP="unknown"'],
      ['no ##VEP line', null]
    ])('%s', (_label, vep) => {
      const header = makeHeader({ vep })
      expect(isVepClinSigAlleleSpecific(header)).toBe(false)
      expect(clinvarOf(header, record)).toEqual([null])
    })
  })

  it('accepts a recognised VEP release without a recorded command line or cache', () => {
    const header = makeHeader({ vep: '##VEP="v104" API="v104"', commandLine: null })
    expect(isVepClinSigAlleleSpecific(header)).toBe(true)
    expect(clinvarOf(header, makeRecord([['CSQ', csq('benign')]]))).toEqual(['Benign'])
  })

  it('accepts an explicit --clin_sig_allele 1', () => {
    const header = makeHeader({
      commandLine: "##VEP-command-line='vep --cache --clin_sig_allele 1 --vcf'"
    })
    expect(isVepClinSigAlleleSpecific(header)).toBe(true)
  })
})

describe('normalizeVepClinSig', () => {
  it.each([
    ['benign', 'Benign'],
    ['uncertain_significance', 'Uncertain_significance'],
    ['pathogenic/likely_pathogenic', 'Pathogenic/Likely_pathogenic'],
    [
      'conflicting_interpretations_of_pathogenicity',
      'Conflicting_interpretations_of_pathogenicity'
    ],
    ['likely_benign&risk_factor', 'Likely_benign|risk_factor'],
    ['not_provided', 'not_provided'],
    ['Pathogenic', 'Pathogenic']
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeVepClinSig(raw)).toBe(expected)
  })

  it.each([[undefined], [''], ['&'], ['.']])('returns null for %s', (raw) => {
    expect(normalizeVepClinSig(raw)).toBeNull()
  })
})

describe('sources that must stay unaffected', () => {
  it('SnpEff ANN files never receive a clinvar value from annotations', () => {
    const header = parseVcfHeaderFromLines([
      '##fileformat=VCFv4.2',
      VEP_115,
      '##INFO=<ID=ANN,Number=.,Type=String,Description="Functional annotations: \'Allele | Annotation | Annotation_Impact | Gene_Name | Gene_ID | Feature_Type | Feature_ID | Transcript_BioType | Rank | HGVS.c | HGVS.p | cDNA.pos / cDNA.length | CDS.pos / CDS.length | AA.pos / AA.length | Distance | ERRORS / WARNINGS / INFO\' ">',
      '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1'
    ])
    const record = makeRecord([
      [
        'ANN',
        'G|missense_variant|MODERATE|CHEK2|ENSG00000183765|transcript|ENST00000404276|protein_coding|3/15|c.1A>G|p.Met1Val|1/1|1/1|1/1||pathogenic'
      ]
    ])
    expect(isVepClinSigAlleleSpecific(header)).toBe(false)
    expect(clinvarOf(header, record)).toEqual([null])
  })

  it('JSON object import passes clinvar through untouched', async () => {
    const results: Array<Record<string, unknown>> = []
    await pipeline(
      Readable.from(
        [
          {
            key: 0,
            value: { chr: '22', pos: 1, ref: 'A', alt: 'G', clinvar: 'benign&likely_benign' }
          }
        ],
        { objectMode: true }
      ),
      createObjectFormatMapper(),
      new Writable({
        objectMode: true,
        write(chunk, _enc, cb) {
          results.push(chunk as Record<string, unknown>)
          cb()
        }
      })
    )
    expect(results[0].clinvar).toBe('benign&likely_benign')
  })
})
